// Accès aux données publiques :
// - prix et ruptures : flux instantané v2 de prix-carburants (data.economie.gouv.fr) ;
// - enseigne : liste des stations Total générée depuis OpenStreetMap (npm run maj-total),
//   via le tag ref:FR:prix-carburants qui porte l'identifiant officiel.

import STATIONS_TOTAL from './stations-total.json';

export type Carburant = 'SP95' | 'SP98' | 'E10';
export const CARBURANTS: Carburant[] = ['SP95', 'SP98', 'E10'];

/** dispo = en vente ; rupture = rupture temporaire ; absent = jamais vendu ici (ou rupture définitive). */
export type Etat = 'dispo' | 'rupture' | 'absent';

export interface InfoCarburant {
  etat: Etat;
  prix?: number;
  depuis?: string; // date de mise à jour du prix, ou début de la rupture
}

export interface Station {
  id: string;
  marque: string;
  adresse: string;
  ville: string;
  lat: number;
  lon: number;
  distanceKm: number;
  carburants: Record<Carburant, InfoCarburant>;
}

export interface Position {
  lat: number;
  lon: number;
}

const ODS_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

const TOTAL = new Map(Object.entries(STATIONS_TOTAL as Record<string, string>));

interface EnregistrementOds {
  id: number;
  adresse: string | null;
  ville: string | null;
  geom: { lat: number; lon: number } | null;
  carburants_disponibles: string[] | null;
  sp95_prix: number | null;
  sp95_maj: string | null;
  sp95_rupture_type: string | null;
  sp95_rupture_debut: string | null;
  sp98_prix: number | null;
  sp98_maj: string | null;
  sp98_rupture_type: string | null;
  sp98_rupture_debut: string | null;
  e10_prix: number | null;
  e10_maj: string | null;
  e10_rupture_type: string | null;
  e10_rupture_debut: string | null;
}

async function stationsOfficielles(pos: Position, rayonKm: number): Promise<EnregistrementOds[]> {
  const select = [
    'id', 'adresse', 'ville', 'geom', 'carburants_disponibles',
    'sp95_prix', 'sp95_maj', 'sp95_rupture_type', 'sp95_rupture_debut',
    'sp98_prix', 'sp98_maj', 'sp98_rupture_type', 'sp98_rupture_debut',
    'e10_prix', 'e10_maj', 'e10_rupture_type', 'e10_rupture_debut',
  ].join(',');
  const where = `within_distance(geom, geom'POINT(${pos.lon} ${pos.lat})', ${rayonKm}km)`;
  const resultats: EnregistrementOds[] = [];
  // L'API limite à 100 résultats par page.
  for (let offset = 0; ; offset += 100) {
    const params = new URLSearchParams({ where, select, limit: '100', offset: String(offset) });
    const rep = await fetch(`${ODS_URL}?${params}`);
    if (!rep.ok) throw new Error(`prix-carburants : HTTP ${rep.status}`);
    const json = (await rep.json()) as { total_count: number; results: EnregistrementOds[] };
    resultats.push(...json.results);
    if (resultats.length >= json.total_count || json.results.length === 0 || offset >= 900) break;
  }
  return resultats;
}

function infoCarburant(r: EnregistrementOds, c: Carburant): InfoCarburant {
  const k = c.toLowerCase() as 'sp95' | 'sp98' | 'e10';
  if (r.carburants_disponibles?.includes(c)) {
    return { etat: 'dispo', prix: r[`${k}_prix`] ?? undefined, depuis: r[`${k}_maj`] ?? undefined };
  }
  if (r[`${k}_rupture_type`] === 'temporaire') {
    return { etat: 'rupture', depuis: r[`${k}_rupture_debut`] ?? undefined };
  }
  return { etat: 'absent' };
}

export function distanceKm(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Stations Total dans le rayon qui vendent du SP95, du SP98 ou de l'E10, triées par distance. */
export async function chercherStations(pos: Position, rayonKm: number): Promise<Station[]> {
  const officielles = await stationsOfficielles(pos, rayonKm);
  return officielles
    .filter((r) => r.geom && TOTAL.has(String(r.id)))
    .map((r): Station => ({
      id: String(r.id),
      marque: TOTAL.get(String(r.id))!,
      adresse: r.adresse ?? '',
      ville: r.ville ?? '',
      lat: r.geom!.lat,
      lon: r.geom!.lon,
      distanceKm: distanceKm(pos, r.geom!),
      carburants: { SP95: infoCarburant(r, 'SP95'), SP98: infoCarburant(r, 'SP98'), E10: infoCarburant(r, 'E10') },
    }))
    .filter((s) => CARBURANTS.some((c) => s.carburants[c].etat !== 'absent'))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Géocodage d'une ville ou d'une adresse (Base Adresse Nationale). */
export async function geocoder(texte: string): Promise<(Position & { libelle: string }) | null> {
  const params = new URLSearchParams({ q: texte, limit: '1' });
  const rep = await fetch(`https://api-adresse.data.gouv.fr/search/?${params}`);
  if (!rep.ok) throw new Error(`Recherche d'adresse : HTTP ${rep.status}`);
  const json = (await rep.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: { label: string } }[];
  };
  const f = json.features[0];
  if (!f) return null;
  return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], libelle: f.properties.label };
}
