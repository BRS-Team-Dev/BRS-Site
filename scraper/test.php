<?php
header('Content-Type: text/plain');
error_reporting(E_ALL);
ini_set('display_errors', '1');

echo "1. PHP is executing and echoing: OK\n";
echo "2. PHP version: " . PHP_VERSION . "\n";
echo "3. cURL extension loaded: " . (function_exists('curl_init') ? 'YES' : 'NO - enable extension=curl in php.ini') . "\n";

echo "4. Testing HTTPS call to Find a Tender...\n";
$ch = curl_init('https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=1&stages=tender');
curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_SSL_VERIFYPEER => true,
));
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

echo "   HTTP code: " . $code . "\n";
echo "   cURL error: " . ($err !== '' ? $err : 'none') . "\n";
echo "   Bytes received: " . strlen((string)$body) . "\n";
echo "5. First 300 chars of response:\n";
echo substr((string)$body, 0, 300) . "\n";