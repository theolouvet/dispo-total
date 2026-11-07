import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import { CARBURANTS, chercherStations, geocoder, type Etat, type Position, type Station } from './api';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const elStatut = $('#statut');
const elListe = $('#liste');
const elRayon = $<HTMLSelectElement>('#rayon');
const elDispo = $<HTMLInputElement>('#seulement-dispo');
const elAdresse = $<HTMLInputElement>('#adresse');
const elContenu = $('#contenu');

// Préférences mémorisées sur l'appareil (facultatif : tout marche sans).
const prefs = {
  lire(cle: string) {
    try { return localStorage.getItem(cle); } catch { return null; }
  },
  ecrire(cle: string, v: string) {
    try { localStorage.setItem(cle, v); } catch { /* stockage indisponible */ }
  },
};
elRayon.value = prefs.lire('rayon') ?? elRayon.value;
elDispo.checked = prefs.lire('seulementDispo') === '1';

let position: Position | null = null;
let stations: Station[] = [];
let requeteEnCours = 0;

// ---------- Carte ----------
const carte = L.map('carte', { zoomControl: true }).setView([46.6, 2.4], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(carte);
const coucheStations = L.layerGroup().addTo(carte);
let marqueurMoi: L.CircleMarker | null = null;
let cercleRayon: L.Circle | null = null;
// Sur mobile, la carte peut être masquée (taille nulle) au moment de la recherche : on la cadre en l'affichant.
let cadrageEnAttente = false;

function cadrer() {
  if (!cercleRayon) return;
  if ($('#carte').offsetWidth === 0) {
    cadrageEnAttente = true;
    return;
  }
  cadrageEnAttente = false;
  carte.fitBounds(cercleRayon.getBounds());
}

const COULEURS = { dispo: '#16a34a', rupture: '#dc2626', partiel: '#f59e0b' };

function etatGlobal(s: Station): keyof typeof COULEURS {
  const etats = CARBURANTS.map((c) => s.carburants[c].etat).filter((e) => e !== 'absent');
  if (etats.every((e) => e === 'dispo')) return 'dispo';
  if (etats.some((e) => e === 'dispo')) return 'partiel';
  return 'rupture';
}

// ---------- Rendu ----------
const LIBELLE: Record<Etat, string> = { dispo: 'En stock', rupture: 'Rupture', absent: 'Non vendu' };

function echapper(t: string) {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ficheStation(s: Station) {
  const puces = CARBURANTS.map((c) => {
    const info = s.carburants[c];
    const detail =
      info.etat === 'dispo' && info.prix ? `${info.prix.toFixed(3)} €`
      : info.etat === 'rupture' && info.depuis ? `depuis ${formatDate(info.depuis)}`
      : LIBELLE[info.etat];
    return `<span class="puce ${info.etat}" title="${c} : ${LIBELLE[info.etat]}"><b>${c}</b> ${echapper(detail)}</span>`;
  }).join('');
  const itineraire = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  return `
    <h2>${echapper(s.ville)} <small>${s.distanceKm.toFixed(1)} km</small></h2>
    <p class="adresse">${echapper(s.adresse)} · ${echapper(s.marque)}</p>
    <div class="puces">${puces}</div>
    <a class="itineraire" href="${itineraire}" target="_blank" rel="noopener">Itinéraire ↗</a>`;
}

function afficher() {
  const visibles = elDispo.checked ? stations.filter((s) => etatGlobal(s) !== 'rupture') : stations;

  elListe.innerHTML = visibles.length
    ? visibles.map((s) => `<article class="station ${etatGlobal(s)}" data-id="${s.id}">${ficheStation(s)}</article>`).join('')
    : position ? '<p class="vide">Aucune station Total trouvée avec ces critères. Essayez un rayon plus grand.</p>' : '';

  coucheStations.clearLayers();
  for (const s of visibles) {
    L.circleMarker([s.lat, s.lon], {
      radius: 9,
      color: '#fff',
      weight: 2,
      fillColor: COULEURS[etatGlobal(s)],
      fillOpacity: 1,
    })
      .bindPopup(`<div class="popup">${ficheStation(s)}</div>`)
      .addTo(coucheStations);
  }
}

// Cliquer une fiche la montre sur la carte.
elListe.addEventListener('click', (e) => {
  const fiche = (e.target as HTMLElement).closest<HTMLElement>('.station');
  if (!fiche || (e.target as HTMLElement).closest('a')) return;
  const s = stations.find((x) => x.id === fiche.dataset.id);
  if (!s) return;
  changerVue('carte');
  cadrageEnAttente = false;
  carte.invalidateSize();
  carte.setView([s.lat, s.lon], 15);
  coucheStations.eachLayer((l) => {
    const m = l as L.CircleMarker;
    const p = m.getLatLng();
    if (p.lat === s.lat && p.lng === s.lon) m.openPopup();
  });
});

// ---------- Recherche ----------
async function rechercher(pos: Position, recentrer = true) {
  position = pos;
  const rayon = Number(elRayon.value);
  const num = ++requeteEnCours;
  elStatut.textContent = 'Recherche des stations…';
  elStatut.classList.remove('erreur');

  marqueurMoi?.remove();
  cercleRayon?.remove();
  marqueurMoi = L.circleMarker([pos.lat, pos.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
    .bindTooltip('Point de recherche')
    .addTo(carte);
  cercleRayon = L.circle([pos.lat, pos.lon], { radius: rayon * 1000, color: '#2563eb', weight: 1, fillOpacity: 0.04, interactive: false }).addTo(carte);
  if (recentrer) cadrer();

  try {
    const res = await chercherStations(pos, rayon);
    if (num !== requeteEnCours) return; // une recherche plus récente a été lancée
    stations = res;
    const enStock = res.filter((s) => etatGlobal(s) !== 'rupture').length;
    elStatut.textContent = `${res.length} station${res.length > 1 ? 's' : ''} Total dans ${rayon} km · ${enStock} avec du SP95, SP98 ou E10 · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    afficher();
  } catch (e) {
    if (num !== requeteEnCours) return;
    elStatut.textContent = navigator.onLine
      ? `Impossible de récupérer les données (${(e as Error).message}). Réessayez dans un instant.`
      : 'Pas de connexion : impossible de vérifier les stocks.';
    elStatut.classList.add('erreur');
  }
}

function localiser() {
  if (!('geolocation' in navigator)) {
    elStatut.textContent = 'La localisation n’est pas disponible : saisissez une ville.';
    return;
  }
  elStatut.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    (p) => rechercher({ lat: p.coords.latitude, lon: p.coords.longitude }),
    (err) => {
      elStatut.textContent =
        err.code === err.PERMISSION_DENIED
          ? 'Localisation refusée : saisissez une ville ou déplacez la carte puis « Chercher ici ».'
          : 'Position introuvable : saisissez une ville ou utilisez « Chercher ici » sur la carte.';
      elStatut.classList.add('erreur');
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
  );
}

$('#btn-localiser').addEventListener('click', localiser);

$<HTMLFormElement>('#recherche').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texte = elAdresse.value.trim();
  if (!texte) return localiser();
  elAdresse.blur();
  try {
    const lieu = await geocoder(texte);
    if (!lieu) {
      elStatut.textContent = `Lieu « ${texte} » introuvable.`;
      elStatut.classList.add('erreur');
      return;
    }
    elAdresse.value = lieu.libelle;
    rechercher(lieu);
  } catch (err) {
    elStatut.textContent = (err as Error).message;
    elStatut.classList.add('erreur');
  }
});

elRayon.addEventListener('change', () => {
  prefs.ecrire('rayon', elRayon.value);
  if (position) rechercher(position);
});

elDispo.addEventListener('change', () => {
  prefs.ecrire('seulementDispo', elDispo.checked ? '1' : '0');
  afficher();
});

$('#btn-ici').addEventListener('click', () => {
  const c = carte.getCenter();
  rechercher({ lat: c.lat, lon: c.lng }, false);
});

// ---------- Onglets (mobile) ----------
function changerVue(vue: 'liste' | 'carte') {
  elContenu.classList.toggle('vue-liste', vue === 'liste');
  elContenu.classList.toggle('vue-carte', vue === 'carte');
  document.querySelectorAll<HTMLButtonElement>('.onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.vue === vue));
  if (vue === 'carte') {
    setTimeout(() => {
      carte.invalidateSize();
      if (cadrageEnAttente) cadrer();
    }, 0);
  }
}
document.querySelectorAll<HTMLButtonElement>('.onglets button').forEach((b) =>
  b.addEventListener('click', () => changerVue(b.dataset.vue as 'liste' | 'carte')),
);

// Relance la recherche au retour du réseau.
window.addEventListener('online', () => {
  if (position) rechercher(position, false);
});

// PWA : cache de l'appli (uniquement en production, pour ne pas gêner le développement).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* l'appli marche sans */ });
}

// Recherche automatique à l'ouverture.
localiser();
