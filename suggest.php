<?php

$term = $_GET['term'];

$data = file_get_contents("http://search.uiowa.edu/suggest?site=default_collection&client=default_frontend&access=p&format=rich&q=$term");

$json=json_decode($data,true);
$outp = array();
foreach($json["results"] as $term) {
  $outp[] = '"' . (string) $term[name] . '"';
}
echo "[" . implode(", ", $outp) . "]";
?>
