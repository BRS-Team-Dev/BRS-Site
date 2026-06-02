<?php
declare(strict_types=1);

namespace BRS;

/**
 * Creates and synchronizes the per-form MySQL table that mirrors a form's fields.
 * Identifiers are validated by regex before interpolation (PDO can't parameterize identifiers).
 */
final class Ddl
{
    public const RESERVED = ['id', 'submitted_at', 'ip_address'];
    public const IDENT_RE = '/^[a-z][a-z0-9_]{0,59}$/';

    public static function tableName(string $slug): string
    {
        if (!preg_match(self::IDENT_RE, $slug)) {
            throw new \InvalidArgumentException("Invalid slug: $slug");
        }
        return 'form_' . $slug;
    }

    public static function assertField(array $f): void
    {
        if (!isset($f['name']) || !preg_match(self::IDENT_RE, $f['name'])) {
            throw new \InvalidArgumentException("Invalid field name: " . ($f['name'] ?? ''));
        }
        if (in_array($f['name'], self::RESERVED, true)) {
            throw new \InvalidArgumentException("Reserved field name: " . $f['name']);
        }
    }

    public static function sqlTypeFor(string $type): string
    {
        return match ($type) {
            'text','email','tel','url','password' => 'VARCHAR(255) NULL',
            'select','radio','style_cards'        => 'VARCHAR(255) NULL',
            'textarea'                            => 'TEXT NULL',
            'number'                              => 'DECIMAL(18,4) NULL',
            'checkbox'                            => 'TEXT NULL', // JSON array
            'date'                                => 'DATE NULL',
            'datetime'                            => 'DATETIME NULL',
            'file'                                => 'VARCHAR(500) NULL',
            'multi_file'                          => 'TEXT NULL', // JSON array of paths
            'color'                               => 'VARCHAR(20) NULL', // hex like #RRGGBB
            default                               => throw new \InvalidArgumentException("Unknown type: $type"),
        };
    }

    public static function createTable(string $slug, array $fields): void
    {
        $table = self::tableName($slug);
        $cols  = [
            "`id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY",
            "`submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
            "`ip_address` VARCHAR(45) NULL",
        ];
        foreach ($fields as $f) {
            self::assertField($f);
            $cols[] = sprintf('`%s` %s', $f['name'], self::sqlTypeFor($f['type']));
        }
        $sql = "CREATE TABLE `$table` (" . implode(', ', $cols) . ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
        Db::pdo()->exec($sql);
    }

    public static function dropTable(string $slug): void
    {
        $table = self::tableName($slug);
        Db::pdo()->exec("DROP TABLE IF EXISTS `$table`");
    }

    /** Old fields keyed by field id, new fields keyed by field id (use 'new' for ones without id yet). */
    public static function syncTable(string $oldSlug, string $newSlug, array $oldFields, array $newFields): void
    {
        $oldTable = self::tableName($oldSlug);
        $newTable = self::tableName($newSlug);
        $pdo = Db::pdo();

        // Rename table if slug changed
        if ($oldSlug !== $newSlug) {
            $pdo->exec("RENAME TABLE `$oldTable` TO `$newTable`");
        }
        $table = $newTable;

        $oldById = [];
        foreach ($oldFields as $f) { if (!empty($f['id'])) $oldById[(int)$f['id']] = $f; }

        $newIds = [];
        foreach ($newFields as $f) {
            self::assertField($f);
            $sqlType = self::sqlTypeFor($f['type']);
            if (!empty($f['id']) && isset($oldById[(int)$f['id']])) {
                $old = $oldById[(int)$f['id']];
                $newIds[(int)$f['id']] = true;
                $renamed   = $old['name'] !== $f['name'];
                $retyped   = $old['type'] !== $f['type'];
                if ($renamed) {
                    $pdo->exec("ALTER TABLE `$table` CHANGE COLUMN `{$old['name']}` `{$f['name']}` $sqlType");
                } elseif ($retyped) {
                    $pdo->exec("ALTER TABLE `$table` MODIFY COLUMN `{$f['name']}` $sqlType");
                }
            } else {
                // new column
                $pdo->exec("ALTER TABLE `$table` ADD COLUMN `{$f['name']}` $sqlType");
            }
        }

        // drop columns whose ids are no longer present
        foreach ($oldById as $id => $old) {
            if (!isset($newIds[$id])) {
                $pdo->exec("ALTER TABLE `$table` DROP COLUMN `{$old['name']}`");
            }
        }
    }
}
