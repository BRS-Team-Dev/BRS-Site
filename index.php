<?php
// Redirect to the admin shell. Base path is derived from the script's URL
// directory so this works at any mount point (local /builtrightstudio/cms,
// server /cc, etc.) without environment-specific edits.
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
header('Location: ' . $base . '/admin/forms', true, 302);
