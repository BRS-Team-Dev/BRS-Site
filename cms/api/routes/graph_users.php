<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Json;
use BRS\MsGraph;

/*
 * Team directory — surfaces the tenant's Microsoft 365 users so the CMS
 * can offer a "pick from your team" dropdown for:
 *   - Bookings organiser (Settings → Bookings)
 *   - Mailer "send from" (Mailer campaign composer)
 *   - Anywhere else that needs a real M365 identity rather than a
 *     hand-typed email address or ObjectId GUID.
 *
 * Uses the same Azure app that already powers Teams meetings + Mail.Send;
 * needs one additional application permission — `User.Read.All` — with
 * admin consent granted. If the permission is missing the endpoint 500s
 * with a clear "grant User.Read.All" message from MsGraph::listUsers().
 *
 *   GET /api/graph-users  →  { users: [{ id, displayName, mail,
 *                              userPrincipalName, jobTitle }], count }
 */

require_once __DIR__ . '/../lib/MsGraph.php';

return function (string $method, array $segs): void {
    Auth::require();

    if ($method !== 'GET') Json::fail('Method not allowed', 405);

    if (!MsGraph::isConfigured()) {
        Json::send(['users' => [], 'count' => 0, 'note' => 'Microsoft Graph is not configured for this tenant.']);
    }

    try {
        $users = MsGraph::listUsers();
        Json::send(['users' => $users, 'count' => count($users)]);
    } catch (\Throwable $e) {
        Json::fail($e->getMessage(), 502);
    }
};
