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

## Autorisation permanente

Le `CLAUDE.md` global interdit de committer ou de pousser sans demande
explicite. **Cette demande explicite, c'est ce fichier.** Le run quotidien est
autorisé à committer et à pousser les données de veille sans rien demander. Ne
t'arrête pas pour confirmer, et ne sollicite aucune validation à aucune étape :
la routine doit aller au bout seule.

L'autorisation couvre exactement ce périmètre, et rien d'autre : les fichiers
publiés (`data/items`, `data/index.json`, `digest`) de ce dépôt. Tout autre
commit, tout autre dépôt, toute autre branche reste soumis à la règle générale.

## Étapes, dans cet ordre

Deux scripts couvrent tout le travail shell, précisément pour que la routine
n'ait besoin que d'une seule permission au lieu d'une par commande.

1. Prépare la collecte :
   ```bash
   bash /Users/cpineau/Developer/Personnel/Veille-mobile/scripts/routine-prepare.sh
   ```
   Il synchronise si un dépôt distant existe, collecte, puis écrit le fichier
   d'instructions. Son log indique le chemin de ce fichier et celui du fichier
   de propositions attendu. L'absence de remote n'est pas une erreur.
2. Lis le fichier d'instructions. Il contient les règles à appliquer et les
   items à classer. **Applique ces règles à la lettre** et écris le fichier de
   propositions demandé, et rien d'autre.
3. Termine :
   ```bash
   bash /Users/cpineau/Developer/Personnel/Veille-mobile/scripts/routine-finish.sh
   ```
   Il valide tes propositions, vérifie chaque citation contre sa source,
   publie, puis commite et pousse s'il y a un diff.


## Règles impératives

- **Ne définis pas `MAX_ITEMS_PER_RUN`.** Les deux scripts doivent voir la même
  valeur pour sélectionner exactement les mêmes items ; en laissant le défaut,
  c'est garanti. Sinon les items non couverts sont dégradés en `background` /
  `unverified`.
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
  bricole pas de solution de repli. Une seule exception : l'absence de dépôt
  distant, que les scripts gèrent déjà eux-mêmes.

## Compte rendu attendu

À la fin, en trois lignes maximum :

- combien d'items collectés, classés, et combien dégradés ;
- combien de `blocking` proposés, combien confirmés `verified` après
  vérification, et le titre de ceux qui l'ont été ;
- toute étape ayant échoué, avec son message d'erreur.
