# Dispo Total SP95 / SP98

Petite appli web (mobile et ordinateur) qui indique, autour de votre position, quelles stations **Total** ont encore du **SP95** ou du **SP98**, avec une liste et une carte.

## Fonctionnement

- **Ruptures et prix** : flux instantané officiel [prix-carburants](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/), mis à jour toutes les ~10 minutes. Les données sont déclarées par les stations elles-mêmes.
- **Enseigne** : le flux officiel ne donne pas la marque. `src/stations-total.json` liste les identifiants des stations Total, tirés d'OpenStreetMap (tag `ref:FR:prix-carburants`). Une station Total absente d'OpenStreetMap n'apparaîtra pas.
- **Position** : géolocalisation du navigateur (HTTPS requis), ou recherche d'une ville via la Base Adresse Nationale, ou bouton « Chercher ici » sur la carte.

Pour chaque carburant : **En stock** (prix affiché), **Rupture** (rupture temporaire, avec sa date de début) ou **Non vendu**. Les stations qui ne vendent ni SP95 ni SP98 sont masquées.

Aucun serveur ni clé d'API : tout est appelé depuis le navigateur.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # site statique dans dist/
npm run maj-total  # régénère la liste des stations Total
```

## Déploiement

Le workflow `.github/workflows/pages.yml` publie le site sur GitHub Pages à chaque push sur `main`, et chaque lundi pour rafraîchir la liste des stations Total. Dans les réglages du dépôt : *Settings → Pages → Source : GitHub Actions*.
