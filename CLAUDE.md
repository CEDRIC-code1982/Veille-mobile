# Instructions pour ce dépôt

Ce projet existe pour lutter contre les affirmations non vérifiées. Les règles
ci-dessous ne sont pas des préférences de style : elles sont la raison d'être du
dépôt.

## Règles absolues

1. **Aucune valeur factuelle inventée.** Jamais de date, de numéro de version,
   d'échéance ou d'URL « plausible » en dur dans le code ou les données. Si une
   URL doit être ajoutée à `config/feeds.yaml`, la vérifier par un vrai fetch
   (`npm run check:feeds`) et la retirer si elle ne répond pas. Un fichier de
   données d'exemple doit être marqué explicitement comme tel.
2. **Le dépôt est public et aucun contexte professionnel ne doit y apparaître.**
   Ni nom d'entreprise, de client, de projet, de produit interne, de code
   projet, de dépôt interne, de package interne, ni URL d'infrastructure privée.
   Cela couvre le code, les données, les messages de commit, les noms de
   branches, le README, les issues créées par le bot, les digests et les
   métadonnées du site. En cas de doute, omettre.
   Les éditeurs de l'écosystème (Apple, Google, Meta, Microsoft) sont du contenu
   public : ils sont autorisés.
3. **`impactedProjects` ne contient que des codes opaques** (`proj-a`, …). Ne
   jamais demander au modèle quels projets sont concernés : il ne sait pas
   qu'ils existent. Le calcul vient de `config/project-profiles.json`.
4. **Ne jamais lire, écrire ni logger la clé API.** Elle vit uniquement dans un
   secret de dépôt.

## Conventions de code

TypeScript strict, `strict: true` et `noUncheckedIndexedAccess: true`. La CI
échoue sur `any`.

- `any` **banni** → `unknown` plus un type guard.
- `!` (non-null assertion) **interdit** → `??` ou conditionner l'utilisation.
- `forEach()` **banni** → `for...of`.
- Accolades **toujours** obligatoires, même pour une seule instruction.
- Enums : pas de mot-clé `enum` → objet `as const` plus un type du même nom.
- Pas d'export par défaut. Imports en chemins relatifs, triés : externes
  d'abord, puis locaux, chacun par ordre alphabétique.
- Nommage en anglais : `camelCase` pour les variables et fonctions,
  `PascalCase` pour les types, `SCREAMING_SNAKE_CASE` pour les constantes
  globales. Les booléens commencent par `is`/`are`/`has`.
- Commentaires et JSDoc **en anglais**. Le contenu destiné à l'utilisateur
  (résumés, digest, site, issues) est **en français**.
- Sauter une ligne avant un `return` si une instruction au même niveau
  d'indentation le précède.

`eslint.config.js` fait respecter tout ce qui est automatisable. Lancer
`npm run lint`, `npm run typecheck` et `npm test` avant chaque commit.

## Frontières d'architecture

À ne pas franchir :

- `src/domain/` ne dépend **d'aucune** bibliothèque externe, ni d'un module
  Node. Types purs et fonctions pures. Le temps arrive par le port `Clock`, le
  hachage par `src/shared/hash.ts`.
- `collect.ts` n'appelle jamais le LLM.
- `classify.ts` ne décide jamais de la publication : il produit une proposition,
  et tout ce qu'il écrit porte `trustLevel: "unverified"`.
- `verify.ts` ne fait jamais confiance à la sortie du LLM : il refetche la
  source et confronte la citation au contenu réel.
- `publish.ts` n'appelle jamais le LLM.
- La classification a **deux implémentations** derrière le même port
  `LlmClassifier`, et elles doivent rester interchangeables :
  `AnthropicLlmClassifier` (API Messages) et `FileProposalsClassifier` (fichier
  de propositions écrit par la routine planifiée). Le fichier de propositions
  n'a **aucun** crédit supplémentaire : même schéma Zod, même dégradation, même
  passage par `verify`. Les règles envoyées dans les deux cas viennent de
  `buildSystemPrompt()`, unique source, pour qu'elles ne puissent pas diverger.
- Toute donnée externe (flux, réponse du modèle, fichier JSON, YAML) est validée
  par un schéma Zod avant d'entrer dans le domaine.
- Le site est en HTML, CSS et JS vanilla. **Ne pas proposer React, Vue ou
  Next** : c'est un choix arrêté. Zéro dépendance runtime, zéro bundler.
  `src/tools/buildSite.ts` ne fait que copier des fichiers.

## Résilience

Le pipeline tourne sans relecture humaine. Les comportements attendus :

- un flux mort ne fait jamais échouer le run : `Promise.allSettled`, puis un
  `feedError` transporté avec les données ;
- une réponse du modèle illisible donne droit à **un** retry avec message de
  correction, puis l'item est dégradé en `background` / `unverified`. Jamais de
  crash ;
- un échec de vérification est un déclassement loggé en `WARN`, pas une erreur ;
- une configuration malformée, elle, **doit** faire échouer le run : c'est un
  bug, pas un aléa.

## Format de log

Sans exception, via `src/shared/logger.ts` :

```
[LEVEL][FileName][functionName][line][HH:mm:ss] message
```

Créer le logger avec `createLogger(import.meta.url)`. Un log `ERROR` inclut
toujours l'objet erreur complet en second argument.

## Tests

Vitest, sur fixtures locales. **Aucun appel réseau dans les tests** : les
sources sont injectées via le port `SourceFetcher` (voir
`tests/helpers/fakeFetcher.ts`).

Les quatre cas de `verify` sont obligatoires et ne doivent jamais disparaître :
citation retrouvée, citation absente, domaine hors whitelist, page en 404.

Les dates et versions présentes dans les fixtures sont du décor de test, jamais
une affirmation sur le monde réel.
