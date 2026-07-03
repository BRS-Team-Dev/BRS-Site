<?php
declare(strict_types=1);

namespace BRS;

/**
 * NotificationDispatcher — resolves the recipient set for a triggered
 * event and materialises inbox rows in `notifications`. Every trigger
 * point in the code calls:
 *
 *   NotificationDispatcher::fire('crm.form.submitted', [
 *       'title'    => "New submission on {$form['title']}",
 *       'body'     => …,
 *       'link_url' => "/admin/submissions/$id",
 *   ]);
 *
 * The dispatcher:
 *   1. Looks up the event in `notification_events_catalog`
 *   2. Overlays any tenant-specific row in `notification_rules`
 *   3. Resolves the recipient scope to a set of admin_users.id
 *      (role → all users with role, team → team members,
 *       user → literal id, tenant → all users of the tenant)
 *   4. Inserts one `notifications` row per recipient
 *
 * All lookups fail-silent — a broken notification config must NEVER
 * throw out of the code path that triggered the event.
 */
final class NotificationDispatcher
{
    /**
     * @param string $eventKey e.g. 'crm.onboarding.submitted'
     * @param array{title:string, body?:?string, link_url?:?string} $msg
     * @return int Count of inbox rows materialised
     */
    public static function fire(string $eventKey, array $msg): int
    {
        try {
            $pdo = Db::pdo();

            // 1. Catalog lookup
            $stmt = $pdo->prepare('SELECT * FROM notification_events_catalog WHERE event_key = ? AND is_active = 1');
            $stmt->execute([$eventKey]);
            $event = $stmt->fetch();
            if (!$event) return 0;

            $tid = Tenant::id();

            // 2. Tenant rule overlay
            $ruleStmt = $pdo->prepare('SELECT * FROM notification_rules WHERE tenant_id = ? AND event_key = ?');
            $ruleStmt->execute([$tid, $eventKey]);
            $rule = $ruleStmt->fetch();

            $enabled = $rule ? (int)$rule['enabled'] === 1 : true;
            if (!$enabled) return 0;

            $scope       = $rule ? (string)$rule['recipient_scope']    : (string)$event['default_recipient_scope'];
            $ref         = $rule ? $rule['recipient_ref']              : $event['default_recipient_ref'];
            $createsTask = $rule ? (int)$rule['creates_task']          : (int)$event['default_creates_task'];
            if ($scope === 'none') return 0;

            // 3. Resolve to a user id list
            $userIds = self::resolveRecipients($pdo, $tid, $scope, $ref);
            if (!$userIds) return 0;

            $title = mb_substr((string)($msg['title'] ?? $event['label']), 0, 255);
            $body  = $msg['body'] ?? null;
            $link  = $msg['link_url'] ?? null;

            // 4. Materialise inbox rows — one per recipient
            $ins = $pdo->prepare(
                'INSERT INTO notifications
                   (tenant_id, user_id, event_key, section, title, body, link_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $count = 0;
            foreach ($userIds as $uid) {
                $ins->execute([
                    $tid, $uid, $eventKey, $event['section'],
                    $title, $body, $link,
                ]);
                $count++;
            }

            // 5. Optional: create a crm_task row assigned to the first
            // resolved recipient so the work item lands on the TaskBoard.
            // Category is derived from the section; CRM events map 1:1,
            // everything else falls back to 'other'. The dispatcher never
            // duplicates the task list — one row per fire, not per
            // recipient (the notifications inbox already fans out).
            if ($createsTask === 1) {
                $sectionToCategory = [
                    'crm'         => 'client',      // will be refined below
                    'hr'          => 'other',
                    'operations'  => 'other',
                    'recruitment' => 'other',
                    'accounting'  => 'other',
                    'management'  => 'other',
                    'tasks'       => 'other',
                ];
                // Narrow the CRM category by the event's second segment
                // so form/onboarding/feedback each land in the right bucket.
                $cat = $sectionToCategory[$event['section']] ?? 'other';
                if ($event['section'] === 'crm') {
                    $parts = explode('.', $eventKey);
                    $mid   = $parts[1] ?? '';
                    $crmMap = [
                        'form'        => 'form',
                        'onboarding'  => 'onboarding',
                        'feedback'    => 'form',
                        'client'      => 'client',
                        'service'     => 'service',
                        'newsletter'  => 'other',
                        'task'        => 'other',
                    ];
                    $cat = $crmMap[$mid] ?? 'other';
                }
                try {
                    $taskDesc = trim(($body ?? '') . ($link ? "\n\n→ $link" : ''));
                    $insTask = Db::pdo()->prepare(
                        'INSERT INTO crm_tasks
                           (tenant_id, title, description, category, priority, status, assignee_user_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?)'
                    );
                    $insTask->execute([
                        $tid,
                        $title,
                        $taskDesc !== '' ? $taskDesc : null,
                        $cat,
                        'medium',
                        'to_do',
                        $userIds[0], // first resolved recipient owns it
                    ]);
                } catch (\Throwable $e) {
                    error_log('[NotificationDispatcher] task create failed for ' . $eventKey . ': ' . $e->getMessage());
                }
            }

            return $count;
        } catch (\Throwable $e) {
            error_log('[NotificationDispatcher] fire failed for ' . $eventKey . ': ' . $e->getMessage());
            return 0;
        }
    }

    /** @return int[] admin_users.id values */
    private static function resolveRecipients(\PDO $pdo, int $tid, string $scope, ?string $ref): array
    {
        switch ($scope) {
            case 'user':
                return $ref !== null ? [(int)$ref] : [];

            case 'role': {
                // ref = role slug. The admin_users.role enum only has
                // 'admin' / 'member' / 'viewer'; catalog slugs like
                // 'super' / 'manager' aren't real roles yet, so map
                // them to 'admin' for now — future migration can add
                // proper enums or a separate roles table.
                $roleMap = ['super' => 'admin', 'manager' => 'admin'];
                $roleSlug = (string)($ref ?? 'admin');
                $roleSlug = $roleMap[$roleSlug] ?? $roleSlug;
                $stmt = $pdo->prepare('SELECT id FROM admin_users WHERE tenant_id = ? AND role = ? AND is_active = 1');
                $stmt->execute([$tid, $roleSlug]);
                return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
            }

            case 'team': {
                // ref = task_teams.slug
                $stmt = $pdo->prepare(
                    'SELECT au.id
                       FROM admin_users au
                       JOIN task_team_members tm ON tm.user_id = au.id
                       JOIN task_teams t ON t.id = tm.team_id
                      WHERE au.tenant_id = ? AND t.slug = ? AND au.active = 1'
                );
                try {
                    $stmt->execute([$tid, (string)$ref]);
                    return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
                } catch (\Throwable $e) {
                    // task_team_members might not exist yet — degrade silently.
                    return [];
                }
            }

            case 'tenant': {
                $stmt = $pdo->prepare('SELECT id FROM admin_users WHERE tenant_id = ? AND is_active = 1');
                $stmt->execute([$tid]);
                return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
            }
        }
        return [];
    }
}
