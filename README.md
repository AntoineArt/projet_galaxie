# Galaxie procédurale : 2×10¹¹ étoiles

Simulation temps réel d'une galaxie spirale complète (bulbe, barre, disques mince et épais, bras,
halo stellaire, poussière, amas globulaires, régions HII, trou noir central) avec évolution
stellaire individuelle, navigation libre du voisinage solaire à la vue extérieure.

```
pnpm install
pnpm dev          # http://localhost:5173
pnpm build
```

## Principe

Aucune étoile n'est stockée. Le nombre d'étoiles par région vient d'un modèle de densité analytique
normalisé à 2×10¹¹ ; chaque étoile est une fonction déterministe `(noeud, tranche, index) → état`,
évaluée dans le vertex shader au moment du rendu. Le temps `t` est un simple uniform : reculer ou
avancer de 10 Ga ne coûte rien.

### Découpage spatial

- Octree cubique de 64 kpc, feuilles de 64 pc (niveau 10). Comptes par composante pré-intégrés sur
  une grille de 512 pc (`grid.ts`), évalués analytiquement en dessous.
- Parcours par frame (CPU, `lod.ts`) : un noeud est subdivisé si `taille / distance > 0.75`, avec une
  taille maximale de 512 pc dans le plan du disque (structure verticale de 300 pc).
- Positions intra-noeud : uniformes, déformées par le gradient local de densité (`warp1`), avec
  dérive azimutale des étoiles du disque (repliement dans le cube) dans le référentiel tournant du
  motif spiral.

### Sélection des étoiles visibles

C'est le coeur de l'optimisation. Dans chaque noeud, les étoiles sont regroupées en 27 tranches de
population (`bins.ts` : halo, bulbe, disque épais, 17 tranches de naissance du disque mince, 6
sous-tranches d'âge pour les étoiles jeunes). Dans chaque tranche l'index croît avec la masse
décroissante (IMF de Kroupa stratifiée). Pour un noeud à distance `d` et un seuil de flux `F_min` :

- borne haute `a_c` : étoiles plus massives que la masse de turnoff de la tranche (mortes, résidus
  invisibles) ; elles ne coûtent aucun sommet ;
- borne basse `b_c` : quantile au-delà duquel aucune étoile de la tranche ne peut dépasser
  `L = F_min d²`, calculé depuis la fonction de luminosité réelle (géantes comprises, `visq.ts`).

Seule l'union des plages `[a_c, b_c)` est dessinée (un draw call instancié par puissance de deux de
`K`). Le seuil `F_min` s'ajuste pour respecter un budget de sommets (1,5 M par défaut).

### Champ lointain

La lumière des étoiles sous le seuil est portée par 1,2 M de points agrégés (`farfield.ts`), chacun
représentant ~2×10⁵ étoiles avec la luminosité et la couleur moyennes de sa population à `t`. Une
table `keep(composante, t, L_cut)` retire exactement la part déjà rendue en étoiles individuelles :
le total lumineux est conservé quel que soit le budget.

### Lumière non résolue près de la caméra

Là où le champ lointain devient granuleux (centre galactique, voisinage immédiat), chaque noeud de
l'octree situé à moins de 4,5 fois sa taille rend sa lumière résiduelle sous forme de quad gaussien
(`glow.ts`), avec fondu croisé vers le champ lointain. La résolution suit donc l'octree.

### Systèmes stellaires

À moins de 0,05 pc d'une étoile, son système est généré (`system.ts`) : compagnon éventuel (fraction
de binaires croissante avec la masse), planètes (rocheuses, super-terres, géantes de glace et de gaz,
joviennes chaudes) placées par rapport à la ligne des glaces, orbites képlériennes calculées en double
précision côté CPU (`render/system.ts`), disques stellaires résolus avec assombrissement centre-bord,
planètes éclairées avec phases. L'étoile correspondante est retirée du rendu LOD (`uSkip`).

### Physique

- IMF de Kroupa 0,01 à 150 M☉ ; naines brunes incluses.
- Objets discrets : 157 amas globulaires (profil de Plummer), ~2500 amas ouverts et ~5000 régions HII
  dans les bras, Sgr A*.
- Évolution (`stellar.ts` / `stellar.glsl`) : séquence principale, géante rouge, supergéante,
  nébuleuse planétaire, naine blanche refroidissante, supernova (flash ~300 ans + rémanent), étoile à
  neutrons, trou noir.
- Histoires de formation par composante ; le disque mince forme des étoiles en continu jusqu'à 20 Ga.
- Extinction interstellaire analytique (`extinction.glsl`) intégrée le long de la ligne de visée,
  avec rougissement ; calibrée à 0,8 mag/kpc au voisinage solaire.
- Courbe de rotation plate (225 pc/Ma), motif spiral à 25 km/s/kpc.

Approximation assumée : les étoiles jeunes des bras ont des âges définis relativement à `t` (onde de
densité stationnaire), les autres ont des dates de naissance absolues.

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD, souris (clic) | vol libre, molette : vitesse, Alt : ×5 |
| Espace / Maj | haut / bas |
| T, [ ] | pause, vitesse du temps (1 jour/s à 1 Ga/s) |
| 0 | retour à aujourd'hui (13 Ga) |
| R / G / H | Soleil / vue extérieure / vue de dessus |
| F | viser l'étoile la plus proche |
| J | sauter à 40 UA de l'étoile la plus proche (vue du système) |
| E | auto-exposition |

Le panneau de droite règle le temps, le budget d'étoiles, l'exposition, le bloom, le champ lointain
et la poussière. Le cadre en bas à droite décrit l'étoile la plus proche (sonde CPU, `probe.ts`,
qui régénère les mêmes étoiles que le GPU).

## Scripts

- `node scripts/shot.mjs out.png [touches]` : capture headless (Playwright, dev server requis).
- `node scripts/perf5.mjs` : mesures de fps par configuration.
- `pnpm dlx tsx scripts/dbg3.ts` : statistiques du LOD depuis plusieurs points de vue.
