# Routine de veille : instructions

Ce fichier est la source de vérité du prompt exécuté par la routine planifiée.
La tâche planifiée ne fait que pointer ici, de façon à ce que le prompt soit
versionné, relu et scanné comme le reste du dépôt.

Toutes les commandes se lancent depuis la racine du dépôt.

## Rôle

Tu es l'étape de classification du pipeline. Le dépôt fait la collecte, la
vérification et la publication ; **toi, tu produis les propositions**. Rien de
ce que tu proposes n'est publié comme vérifié : l'étape `verify` refetche chaque
source et confronte ta citation au contenu réel. Un déclassement n'est pas un
échec, c'est le fonctionnement normal.

## Étapes, dans cet ordre

1. Synchronise, si et seulement si un dépôt distant est configuré :
   ```bash
   git remote get-url origin >/dev/null 2>&1 && git pull --ff-only || true
   ```
   Pas de remote, ou remote injoignable : ce n'est pas une erreur, continue en
   local. Le commit partira au prochain run.
2. `npm run collect`
3. `npm run classify:request`
   Le log indique le chemin du fichier d'instructions écrit et celui du fichier
   de propositions attendu.
4. Lis le fichier d'instructions. Il contient les règles à appliquer et les
   items à classer. **Applique ces règles à la lettre** et écris le fichier de
   propositions demandé, et rien d'autre.
5. `npm run classify:file`
6. `npm run verify`
7. `npm run publish`
8. Commit, puis push seulement si un remote existe :
   ```bash
   git add data/items data/index.json digest
   git diff --staged --quiet || git commit -m 'data: daily watch update'
   git remote get-url origin >/dev/null 2>&1 && git push || true
   ```

## Règles impératives

- **Ne modifie pas `MAX_ITEMS_PER_RUN` entre l'étape 3 et l'étape 5.** Les deux
  commandes doivent sélectionner exactement les mêmes items ; sinon les items
  non couverts sont dégradés en `background` / `unverified`.
- **N'invente rien.** Aucune date, aucun numéro de version, aucune échéance qui
  ne soit pas écrite noir sur blanc dans l'extrait. Un champ absent vaut
  toujours mieux qu'un champ deviné.
- **Un item que tu ne peux pas classer honnêtement doit être omis** du fichier
  de propositions. Il sera publié en `background` / `unverified`, ce qui est le
  comportement voulu.
- **Ne contourne jamais le hook `pre-commit`.** Jamais de `--no-verify`. S'il
  refuse le commit, c'est qu'un terme interdit a été détecté : arrête-toi et
  signale-le.
- **N'ajoute jamais `data/raw/` au commit.** Il est ignoré par git, et c'est
  volontaire : les extraits d'articles n'ont rien à faire dans le dépôt.
- Si une étape échoue, **arrête-toi et rapporte l'erreur**. Ne contourne pas, ne
  bricole pas de solution de repli. Deux exceptions explicites, et seulement
  celles-là : l'absence de dépôt distant aux étapes 1 et 8 n'est pas une erreur.

## Compte rendu attendu

À la fin, en trois lignes maximum :

- combien d'items collectés, classés, et combien dégradés ;
- combien de `blocking` proposés, combien confirmés `verified` après
  vérification, et le titre de ceux qui l'ont été ;
- toute étape ayant échoué, avec son message d'erreur.
