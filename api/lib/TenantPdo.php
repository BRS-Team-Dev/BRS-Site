<?php
declare(strict_types=1);

namespace BRS;

use PDO;
use PDOStatement;

/**
 * Tenant-aware PDO wrapper. Routes use {@see Db::tpdo()} to get an
 * instance; every prepare() call is rewritten through
 * {@see TenantSqlRewriter} so tenant scoping is enforced automatically.
 *
 * Routes can keep their existing patterns:
 *
 *     $pdo = Db::tpdo();
 *     $stmt = $pdo->prepare('SELECT * FROM leads WHERE id = ?');
 *     $stmt->execute([$id]);
 *     // SQL actually sent: SELECT * FROM leads WHERE id = ? AND tenant_id = ?
 *     // Params actually sent: [$id, Tenant::id()]
 *
 * The wrapper delegates the rest of the PDO surface (transactions,
 * lastInsertId, errorInfo, etc.) so routes don't notice the difference.
 *
 * query() and exec() are also tenant-scoped, but those carry params
 * inline rather than via execute(), so they bind Tenant::id() in
 * directly using PDO->quote().
 */
final class TenantPdo
{
    public function __construct(private PDO $inner) {}

    public function prepare(string $sql, array $opts = []): TenantStatement|false
    {
        $info = TenantSqlRewriter::rewrite($sql);
        $stmt = $this->inner->prepare($info['sql'], $opts);
        if ($stmt === false) return false;
        return new TenantStatement($stmt, $info['inject_at']);
    }

    /** Direct query — for SELECTs with no params. Rewrites the SQL to
     *  include tenant_id and binds the literal int via PDO::quote(). */
    public function query(string $sql, ...$fetchModeArgs): TenantStatement|false
    {
        $rewritten = $this->scopeInline($sql);
        $result = empty($fetchModeArgs)
            ? $this->inner->query($rewritten)
            : $this->inner->query($rewritten, ...$fetchModeArgs);
        return $result === false
            ? false
            : new TenantStatement($result, TenantSqlRewriter::NO_INJECTION);
    }

    public function exec(string $sql): int|false
    {
        return $this->inner->exec($this->scopeInline($sql));
    }

    private function scopeInline(string $sql): string
    {
        // Rewrite to add the placeholder, then substitute the FIRST
        // freshly-added `?` with the tenant id literal. Since the
        // rewriter ALWAYS adds the `?` at the tail end of the WHERE
        // clause (or VALUES list), we replace placeholders from the
        // right end one at a time until we've substituted the count of
        // placeholders that matches our injection point.
        //
        // Simpler approach for inline use: rewrite the SQL but with a
        // literal tenant_id value rather than a placeholder.
        $info = TenantSqlRewriter::rewrite($sql);
        if ($info['inject_at'] === TenantSqlRewriter::NO_INJECTION) return $sql;
        // Replace the rewriter's `?` with the literal tenant id. The
        // rewriter ONLY ever adds ONE `?` per call, so we know we want
        // to swap the placeholder at position `inject_at` (zero-indexed
        // count of ?s) in the rewritten string. Easiest: walk the
        // string, replace the (inject_at + 1)th `?` with the tenant id.
        return self::replaceNthPlaceholder($info['sql'], $info['inject_at'], (string)Tenant::id());
    }

    /** Replace the Nth (0-indexed) `?` in $sql with $replacement. */
    private static function replaceNthPlaceholder(string $sql, int $n, string $replacement): string
    {
        $out = '';
        $count = 0;
        $len = strlen($sql);
        for ($i = 0; $i < $len; $i++) {
            if ($sql[$i] === '?') {
                if ($count === $n) {
                    return $out . $replacement . substr($sql, $i + 1);
                }
                $count++;
            }
            $out .= $sql[$i];
        }
        return $out;
    }

    // ── Delegations to the underlying PDO ────────────────────────────
    public function lastInsertId(?string $name = null): string|false {
        return $name === null ? $this->inner->lastInsertId() : $this->inner->lastInsertId($name);
    }
    public function beginTransaction(): bool   { return $this->inner->beginTransaction(); }
    public function commit(): bool             { return $this->inner->commit(); }
    public function rollBack(): bool           { return $this->inner->rollBack(); }
    public function inTransaction(): bool      { return $this->inner->inTransaction(); }
    public function quote(string $s, int $t = PDO::PARAM_STR): string|false { return $this->inner->quote($s, $t); }
    public function errorCode(): ?string       { return $this->inner->errorCode(); }
    public function errorInfo(): array         { return $this->inner->errorInfo(); }
    public function getAttribute(int $a): mixed   { return $this->inner->getAttribute($a); }
    public function setAttribute(int $a, mixed $v): bool { return $this->inner->setAttribute($a, $v); }

    /** Escape hatch — give a route the unwrapped PDO when it really
     *  knows what it's doing (e.g. a super-admin cross-tenant view).
     *  The static scanner still inspects every query, so this isn't a
     *  free pass; the caller's queries must explicitly handle scoping. */
    public function rawPdo(): PDO { return $this->inner; }
}

/** Wraps PDOStatement to splice Tenant::id() into params on execute(). */
final class TenantStatement
{
    public function __construct(private PDOStatement $inner, private int $injectAt) {}

    public function execute(?array $params = null): bool
    {
        if ($this->injectAt !== TenantSqlRewriter::NO_INJECTION) {
            $params = $params ?? [];
            array_splice($params, $this->injectAt, 0, [Tenant::id()]);
        }
        return $this->inner->execute($params);
    }

    // ── Delegations to PDOStatement ──────────────────────────────────
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $ori = PDO::FETCH_ORI_NEXT, int $off = 0): mixed {
        return $this->inner->fetch($mode, $ori, $off);
    }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, ...$args): array {
        return $this->inner->fetchAll($mode, ...$args);
    }
    public function fetchColumn(int $column = 0): mixed { return $this->inner->fetchColumn($column); }
    public function fetchObject(?string $class = 'stdClass', array $args = []): object|false {
        return $this->inner->fetchObject($class, $args);
    }
    public function rowCount(): int { return $this->inner->rowCount(); }
    public function columnCount(): int { return $this->inner->columnCount(); }
    public function bindValue(string|int $param, mixed $value, int $type = PDO::PARAM_STR): bool {
        return $this->inner->bindValue($param, $value, $type);
    }
    public function bindParam(string|int $param, mixed &$var, int $type = PDO::PARAM_STR, int $maxLength = 0, mixed $driverOpts = null): bool {
        return $this->inner->bindParam($param, $var, $type, $maxLength, $driverOpts);
    }
    public function closeCursor(): bool { return $this->inner->closeCursor(); }
    public function setFetchMode(int $mode, ...$args): bool { return $this->inner->setFetchMode($mode, ...$args); }
    public function nextRowset(): bool { return $this->inner->nextRowset(); }
    public function errorCode(): ?string { return $this->inner->errorCode(); }
    public function errorInfo(): array   { return $this->inner->errorInfo(); }
}
