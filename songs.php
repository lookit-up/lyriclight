<?php
header('Content-Type: application/json');

$audioDir = __DIR__ . '/audios/';
$exts = ['mp3', 'wav', 'ogg', 'm4a'];

$songs = [];

if (is_dir($audioDir)) {
    foreach (scandir($audioDir) as $file) {
        if ($file === '.' || $file === '..') continue;
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (!in_array($ext, $exts)) continue;

        $base = pathinfo($file, PATHINFO_FILENAME);

        // Expecting "Artist - Title", but falls back gracefully if not present
        if (strpos($base, ' - ') !== false) {
            [$artist, $title] = array_map('trim', explode(' - ', $base, 2));
        } else {
            $artist = '';
            $title = $base;
        }

        $songs[] = [
            'file'   => 'audios/' . rawurlencode($file),
            'artist' => $artist,
            'title'  => $title,
        ];
    }
}

echo json_encode($songs);
