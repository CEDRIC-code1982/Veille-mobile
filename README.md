# Veille mobile

Veille technologique automatisée sur React Native, TypeScript, iOS et Android :
versions d'OS, nouvelles fonctionnalités, exécution en arrière-plan, Bluetooth/BLE,
matériel. Collecte quotidienne, classification par un modèle, **vérification
déterministe de toute information critique**, publication sur un site statique
consultable depuis un téléphone.

Aucune relecture humaine dans la boucle. C'est précisément pour ça que la règle
de confiance ci-dessous existe.

## Le principe : rien n'est bloquant sans preuve

Un item ne peut porter `criticality: "blocking"` que si les **trois** conditions
sont réunies :

1. son `sourceUrl` appartient à un domaine de `config/official-domains.json`
   (première partie uniquement) ;
2. le modèle a fourni une `evidenceQuote` non vide ;
3. l'étape `verify` a **refetché la page** et **retrouvé cette citation** dans
   son contenu, sur texte normalisé (casse, espaces multiples, entités HTML,
   ponctuation typographique).

Si une seule condition échoue, l'item est automatiquement rétrogradé à
`impacting` au maximum, avec `trustLevel: "unverified"`. **Un échec de
vérification n'est pas une erreur** : c'est un déclassement normal, loggé en
`WARN`, qui ne fait pas échouer le run.

Un blog tiers ne peut jamais produire un `blocking`, même en citant
correctement sa source.

Les trois niveaux de confiance :

| `trustLevel` | Signification |
|---|---|
| `verified` | citation retrouvée dans la source officielle |
| `reported` | domaine officiel, mais citation non retrouvée (ou absente) |
| `unverified` | proposé par le modèle, rien ne le confirme |

Le site affiche le badge `unverified` de façon volontairement voyante.

## Architecture

Quatre étapes indépendantes qui ne communiquent que par fichiers. Aucune ne
connaît l'implémentation des autres.

```
collect  →  classify  →  verify  →  publish
(réseau,    (LLM,        (réseau,   (git, issues,
 0 LLM)      0 réseau     0 LLM)     0 LLM)
             hors API)
```

| Étape | Entrée | Sortie | Règle |
|---|---|---|---|
| `collect` | `config/feeds.yaml` | `data/raw/YYYY-MM-DD.json` | n'appelle jamais le LLM |
| `classify` | le fichier ci-dessus | `data/raw/YYYY-MM-DD.classified.json` | ne décide jamais de la publication |
| `verify` | le fichier ci-dessus | `data/raw/YYYY-MM-DD.verified.json` | ne fait jamais confiance au LLM |
| `publish` | le fichier ci-dessus | `data/items/`, `digest/`, `data/index.json`, issues | n'appelle jamais le LLM |

- `src/domain/` ne dépend d'aucune bibliothèque externe, pas même de
  `node:crypto` : types purs et fonctions pures. Le temps arrive par un port
  `Clock`, le hachage vit dans `src/shared/hash.ts`.
- `src/data/` contient les implémentations (RSS/Atom, scraping, API Anthropic,
  API GitHub).
- `data/raw/` **n'est pas versionné** : c'est là que vivent les extraits
  d'articles, et le contenu tiers n'a rien à faire dans le dépôt. Seuls l'URL,
  un résumé reformulé et la citation-preuve sont publiés.

## Démarrage

```bash
npm ci
npm run check:feeds        # confronte chaque source à un vrai fetch
npm test
npm run lint && npm run typecheck
```

Le pipeline en local, chemin routine, sans aucune clé API :

```bash
npm run collect
npm run classify:request   # écrit les instructions de classification
#                          # ... un modèle écrit le fichier de propositions ...
npm run classify:file      # valide ces propositions par Zod
npm run verify
npm run publish
```

Chemin API, si un jour tu poses une clé :

```bash
ANTHROPIC_API_KEY=... npm run classify
```

Le site en local, servi exactement comme GitHub Pages le servira :

```bash
npm run site:serve
```

## Comment tourne le run quotidien

Le moteur n'est pas un cron GitHub : c'est une **routine planifiée locale**, une
tâche Claude qui tourne chaque matin. Elle est elle-même le modèle : au lieu
d'appeler l'API Messages, elle lit un fichier d'instructions et écrit un fichier
de propositions.

```
routine  ──► npm run collect
         ──► npm run classify:request     → data/raw/<jour>.request.md
         ──► elle classe, et écrit          data/raw/<jour>.proposals.json
         ──► npm run classify:file        → validé par Zod, comme une réponse d'API
         ──► npm run verify               → refetch et confrontation des citations
         ──► npm run publish
         ──► git commit && git push       → déclenche deploy.yml
```

Trois propriétés de ce découpage :

- **Aucune clé API, aucun coût par requête.**
- **La routine n'obtient aucun crédit supplémentaire.** Son fichier de
  propositions passe par le même schéma Zod qu'une réponse d'API, et `verify`
  refetche les sources exactement pareil. Un `blocking` qu'elle propose sans
  citation retrouvable est rétrogradé comme n'importe quel autre.
- **Son `git push` quotidien constitue une activité sur le dépôt**, ce qui
  neutralise le piège des 60 jours décrit plus bas.

Le prompt de la routine vit dans `docs/routine-prompt.md`, versionné et scanné
comme le reste du dépôt. La tâche planifiée ne fait que pointer vers ce fichier,
donc elle ne peut pas dériver du code.

Limite à connaître : **une tâche planifiée ne tourne que si l'application est
ouverte**. Si elle était fermée à l'heure prévue, le run part au lancement
suivant. C'est précisément ce que le watchdog ci-dessous surveille.

`collect.yml` reste en `workflow_dispatch` comme repli manuel, sans cron : deux
moteurs se disputeraient les mêmes données. Sans clé API, son étape de
classification dégrade honnêtement tous les items en `background` /
`unverified` au lieu d'échouer.

## Ajouter une source

1. Ajouter une entrée dans `config/feeds.yaml` :

```yaml
  - name: Nom lisible de la source
    url: https://exemple.invalid/feed.xml
    type: rss            # rss | atom | scrape
    domain: exemple.invalid
    categories: [android, background]
    official: true       # l'éditeur publie sur son propre produit
    maxAgeDays: 21       # seuil de silence
```

2. Lancer `npm run check:feeds`. **Si l'URL ne répond pas, la retirer** plutôt
   que d'inventer une URL plausible. C'est la règle du projet.
3. Si la source doit pouvoir produire un `blocking`, ajouter son domaine à
   `config/official-domains.json`. `official: true` dans `feeds.yaml` ne sert
   qu'à départager les doublons, pas à autoriser un `blocking`.

Précisions sur les champs :

- `categories` doit utiliser les valeurs de `src/domain/entities/Category.ts` :
  `react-native`, `typescript`, `ios`, `android`, `background`, `ble`,
  `hardware`, `tooling`, `policy`.
- `maxAgeDays` s'applique à **l'entrée la plus récente** pour `rss`/`atom`, et
  à **la dernière lecture réussie** pour `scrape` : une page de documentation
  qui ne change pas est normale, un flux figé ne l'est pas.
- `type: scrape` est destiné aux pages sans flux. Leur identité est le hash de
  leur zone principale : un nouvel item apparaît quand, et seulement quand, le
  contenu change réellement.

## Détection de panne silencieuse

Une veille qui s'arrête sans le dire est pire que pas de veille : elle donne
l'impression d'être informé. Deux symptômes ouvrent une issue
`[VEILLE] Flux muet` :

- une source qui ne publie plus rien depuis plus longtemps que son
  `maxAgeDays` ;
- le pipeline entier qui ne collecte plus rien depuis 14 jours
  (`VEILLE_PIPELINE_SILENCE_DAYS`).

Un troisième garde-fou surveille le pipeline lui-même. `watchdog.yml` tourne
chaque jour sur GitHub Actions, ne collecte rien, ne publie rien, n'a besoin
d'aucune clé : il lit `data/index.json` et ouvre une issue
`[VEILLE] Pipeline silencieux` si la dernière collecte date de plus de trois
jours (`VEILLE_HEARTBEAT_SILENCE_DAYS`). C'est ce qui rattrape une machine
éteinte, une routine désactivée ou un `git push` qui échoue.

C'est, avec un `blocking` vérifié, la seule notification autorisée à déranger.
L'idempotence vient d'un marqueur `<!-- veille-fingerprint: ... -->` dans le
corps de l'issue : un run quotidien ne réouvre pas la même issue. La clé d'un
flux muet mélange la semaine ISO et l'ensemble trié des sources silencieuses,
donc un silence qui dure reste silencieux, mais une nouvelle source muette
ouvre bien une issue.

## Le piège du cron désactivé

**GitHub désactive automatiquement les workflows planifiés d'un dépôt public
après 60 jours sans activité sur le dépôt**, et il faut les réactiver à la main
(Actions → le workflow → *Enable workflow*). C'est documenté dans
[Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

C'est le pire scénario possible ici : le workflow ne tourne plus, donc la
détection de flux muet ne tourne pas non plus, donc **le silence est
invisible**. Aucun mécanisme interne au dépôt ne peut rattraper ça.

La parade est déjà en place, et elle est externe au dépôt : **la routine
quotidienne pousse un commit de données**, ce qui constitue une activité sur le
dépôt et remet le compteur à zéro bien avant les 60 jours. Le watchdog reste
donc actif tant que la routine fonctionne.

L'enchaînement est cohérent : si la routine s'arrête, le watchdog ouvre une
issue en trois jours, très largement avant que les 60 jours ne le désactivent à
son tour. Si les deux s'arrêtent en même temps, il faut un déclenchement
manuel :

```bash
gh workflow run watchdog.yml --repo <owner>/Veille-mobile
```

GitHub recommande par ailleurs d'éviter le début d'heure pour les `cron`, les
files d'attente y étant saturées et des jobs pouvant être abandonnés. Le
workflow tourne donc à `37 4 * * *`.

## Secrets de dépôt

| Secret | Rôle | Sans lui |
|---|---|---|
| `FORBIDDEN_TERMS` | filet de confidentialité en CI | `deploy` refuse de publier, et `collect.yml` refuse de committer |
| `ANTHROPIC_API_KEY` | **optionnel** : chemin API au lieu de la routine | rien, la routine ne l'utilise pas |

```bash
gh secret set FORBIDDEN_TERMS --repo <owner>/Veille-mobile
```

`FORBIDDEN_TERMS` contient un terme par ligne, mêmes règles que
`forbidden-terms.local.txt`.

## Confidentialité

Le dépôt est public. Aucun contexte professionnel n'y apparaît.

- `npm run check:privacy` échoue si un motif interdit est trouvé dans les
  fichiers indexés, les fichiers non ignorés à un `git add` près, **tous les
  messages de commit** et **tous les noms de branches**. La correspondance est
  insensible à la casse et tolérante aux séparateurs : un seul terme
  `ExempleEmployeur` attrape aussi `exemple-employeur`, `exemple_employeur` et
  `Exemple Employeur`.
- La liste des motifs vient de `forbidden-terms.local.txt` (gitignoré, voir
  `forbidden-terms.local.txt.example`) ou de `$FORBIDDEN_TERMS`. Avec
  `--require-terms`, l'absence de liste est une erreur : c'est ce que la CI
  utilise.
- **Une violation est signalée par son emplacement et l'index du terme, jamais
  par le terme lui-même** : ce scan tourne aussi dans un log de CI public.
- Le hook `pre-commit` (`.githooks/pre-commit`, câblé par `npm ci`) lance le
  scan à chaque commit local.
- `impactedProjects` ne contient que des codes opaques (`proj-a`, …), calculés
  depuis `config/project-profiles.json`. Le modèle n'est jamais interrogé
  là-dessus : il ne sait pas que ces projets existent.
- Le mapping code → libellé réel vit dans `projects.local.json`, gitignoré. Le
  site tente de le charger et échoue silencieusement : sans lui, il affiche les
  codes.

## Réglages par variable d'environnement

| Variable | Défaut | Effet |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | modèle de classification, identifiant épinglé |
| `MAX_ITEMS_PER_RUN` | `60` | plafond de coût par run |
| `VEILLE_LLM_BATCH_SIZE` | `10` | items par appel API |
| `VEILLE_MAX_ITEM_AGE_DAYS` | `30` | fenêtre de fraîcheur à la collecte |
| `VEILLE_VERIFY_CONCURRENCY` | `4` | refetchs simultanés |
| `VEILLE_PIPELINE_SILENCE_DAYS` | `14` | seuil de silence du pipeline, à la publication |
| `VEILLE_HEARTBEAT_SILENCE_DAYS` | `3` | seuil de silence pour le watchdog |
| `VEILLE_HTTP_TIMEOUT_MS` | `20000` | timeout HTTP |
| `VEILLE_USER_AGENT` | `veille-mobile-bot` | `User-Agent` des requêtes |
| `VEILLE_PREVIEW_PORT` | `8099` | port de `npm run site:serve` |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` |

Les items écartés par `MAX_ITEMS_PER_RUN` sont simplement recollectés le
lendemain : le retard se résorbe seul.

## Format de log

Tous les scripts, sans exception :

```
[LEVEL][FileName][functionName][line][HH:mm:ss] message
```

Un log `ERROR` inclut toujours l'objet erreur complet en second argument.

## Limites connues

1. **La vérification prouve qu'une phrase est sur la page, pas qu'elle est
   pertinente.** Un bandeau de navigation ou une phrase de boilerplate présente
   dans la zone principale peut techniquement servir de preuve. Le chrome
   évident (nav, aside, footer, formulaires) est retiré avant comparaison, mais
   les fils d'Ariane de certains sites de documentation restent dans le texte
   extrait.
2. **Une source qui change d'URL sans rien casser reste invisible un moment.**
   Elle est détectée comme muette après son `maxAgeDays`, pas immédiatement.
3. **Si un item collecté contient un terme interdit, le run échoue au lieu de
   filtrer cet item.** Rien n'est publié, ce qui est le comportement sûr, mais
   toute la journée est perdue plutôt que seul l'item fautif.
4. **La routine ne tourne que si l'application est ouverte à l'heure prévue**,
   sinon elle part au lancement suivant. Le watchdog rattrape le cas où elle ne
   part pas du tout, avec trois jours de latence.
5. **`classify:request` et `classify:file` doivent voir le même
   `MAX_ITEMS_PER_RUN`.** S'ils divergent, les items non couverts par le fichier
   de propositions sont dégradés en `background` / `unverified` : pas une perte
   de données, mais une perte de qualité silencieuse.
