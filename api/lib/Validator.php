<?php
declare(strict_types=1);

namespace BRS;

/**
 * Validates a submission payload against a form's field definitions.
 * Returns a [normalizedRow, errors] tuple.
 */
final class Validator
{
    /**
     * @param array $fields  field defs (name, type, is_required, options_json)
     * @param array $input   submitted values keyed by field name (from JSON or $_POST)
     * @param array $files   $_FILES (already grouped by field name)
     */
    public static function validate(array $fields, array $input, array $files): array
    {
        $row = [];
        $errors = [];

        foreach ($fields as $f) {
            $name = $f['name'];
            $type = $f['type'];
            $req  = !empty($f['is_required']);
            $val  = $input[$name] ?? null;

            if ($type === 'file') {
                $hasFile = isset($files[$name]) && ($files[$name]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK;
                if ($req && !$hasFile) { $errors[$name] = 'required'; continue; }
                $row[$name] = null; // path filled in later by caller after file move
                continue;
            }
            if ($type === 'multi_file') {
                // multi_file collects multiple uploads under the same name (e.g. images[])
                // Caller handles the actual move; we just check at-least-one for required.
                $count = 0;
                if (isset($files[$name])) {
                    if (is_array($files[$name]['name'] ?? null)) {
                        foreach ($files[$name]['error'] as $err) {
                            if ($err === UPLOAD_ERR_OK) $count++;
                        }
                    } elseif (($files[$name]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                        $count = 1;
                    }
                }
                if ($req && $count === 0) { $errors[$name] = 'required'; continue; }
                $row[$name] = null; // paths filled in later
                continue;
            }

            if ($val === null || $val === '' || (is_array($val) && count($val) === 0)) {
                if ($req) $errors[$name] = 'required';
                $row[$name] = null;
                continue;
            }

            switch ($type) {
                case 'email':
                    if (!filter_var($val, FILTER_VALIDATE_EMAIL)) { $errors[$name] = 'invalid email'; break; }
                    $row[$name] = (string)$val;
                    break;
                case 'url':
                    if (!filter_var($val, FILTER_VALIDATE_URL)) { $errors[$name] = 'invalid url'; break; }
                    $row[$name] = (string)$val;
                    break;
                case 'number':
                    if (!is_numeric($val)) { $errors[$name] = 'not a number'; break; }
                    $row[$name] = (string)$val;
                    break;
                case 'date':
                    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val)) { $errors[$name] = 'invalid date'; break; }
                    $row[$name] = (string)$val;
                    break;
                case 'datetime':
                    if (!preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/', (string)$val)) {
                        $errors[$name] = 'invalid datetime'; break;
                    }
                    $row[$name] = str_replace('T', ' ', (string)$val);
                    if (strlen($row[$name]) === 16) $row[$name] .= ':00';
                    break;
                case 'select':
                case 'radio':
                case 'style_cards':
                    $opts = self::optionValues($f);
                    if ($opts && !in_array((string)$val, $opts, true)) { $errors[$name] = 'invalid option'; break; }
                    $row[$name] = (string)$val;
                    break;
                case 'color':
                    if (!preg_match('/^#[0-9a-fA-F]{6}$/', (string)$val)) { $errors[$name] = 'invalid color (use #RRGGBB)'; break; }
                    $row[$name] = strtolower((string)$val);
                    break;
                case 'checkbox':
                    $opts = self::optionValues($f);
                    $vals = is_array($val) ? $val : [$val];
                    foreach ($vals as $v) {
                        if ($opts && !in_array((string)$v, $opts, true)) { $errors[$name] = 'invalid option'; break 2; }
                    }
                    $row[$name] = json_encode(array_values($vals), JSON_UNESCAPED_UNICODE);
                    break;
                case 'tel':
                case 'text':
                case 'password':
                case 'textarea':
                default:
                    $row[$name] = (string)$val;
                    break;
            }
        }
        return [$row, $errors];
    }

    private static function optionValues(array $field): array
    {
        $raw = $field['options_json'] ?? null;
        if (!$raw) return [];
        $parsed = is_array($raw) ? $raw : json_decode($raw, true);
        if (!is_array($parsed)) return [];
        return array_map(fn($o) => (string)($o['value'] ?? $o), $parsed);
    }
}
