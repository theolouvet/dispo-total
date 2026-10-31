// Génère src/stations-total.json : identifiants prix-carburants des stations Total en France,
// d'après OpenStreetMap. À relancer de temps en temps : npm run maj-total
import { writeFile } from 'node:fs/promises';

const requete = `[out:json][timeout:180];
area["ISO3166-1"="FR"][admin_level=2]->.fr;
(
  nwr["amenity"="fuel"]["ref:FR:prix-carburants"]["brand"~"total",i](area.fr);
  nwr["amenity"="fuel"]["ref:FR:prix-carburants"]["name"~"total",i](area.fr);
  nwr["amenity"="fuel"]["ref:FR:prix-carburants"]["operator"~"total",i](area.fr);
);
out tags;`;

const rep = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dispo-total/0.1' },
  body: 'data=' + encodeURIComponent(requete),
});
if (!rep.ok) throw new Error(`Overpass : HTTP ${rep.status}`);
const { elements } = await rep.json();

const stations = {};
for (const { tags } of elements) {
  // Une marque explicite autre que Total (ex. station Esso exploitée par Total) l'emporte.
  if (tags.brand && !/total|elan/i.test(tags.brand)) continue;
  const marque = tags.brand ?? tags.name ?? 'Total';
  for (const ref of tags['ref:FR:prix-carburants'].split(';')) {
    if (/^\d+$/.test(ref.trim())) stations[ref.trim()] = marque;
  }
}
const trie = Object.fromEntries(Object.entries(stations).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL('../src/stations-total.json', import.meta.url), JSON.stringify(trie) + '\n');
console.log(`${Object.keys(trie).length} stations Total enregistrées.`);
