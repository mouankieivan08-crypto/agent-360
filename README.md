# Agent 360 — ton bras droit commercial sur WhatsApp

Un agent IA (Claude) qui vit dans ton WhatsApp et qui est à la fois :

- **ton assistant** : il trouve des entreprises à prospecter (recherche web), rédige les messages, lance les campagnes WhatsApp, suit les réponses et tient ton CRM à jour ;
- **ton mentor** : 15 ans d'expérience en vente B2B, agences et SaaS en Afrique francophone, obsédé par les **revenus récurrents** et par ton objectif chiffré ;
- **ton partenaire de redevabilité** : brief chaque matin, bilan chaque soir, revue chaque dimanche, et il te relance après chaque rendez-vous.

Tu lui parles comme à un humain, par écrit ou en **note vocale**.

```
Toi    : Trouve-moi 30 cliniques et écoles privées à Brazzaville pour mon logiciel de pointage
Agent  : J'en ai trouvé 27 avec un numéro, ajoutées au CRM. Voici le message que je propose :
         « Bonjour, ici [ton prénom] de … Chez {{entreprise}}, comment suivez-vous les retards ? … »
         3 exemples ci-dessous. 25 envois/jour, de 8h30 à 17h30 → ~2 jours. Je lance ?
Toi    : Go
Agent  : C'est parti 🚀 Je te préviens dès qu'il y a des réponses.
…
Agent  : 🔥 Clinique Sainte-Marie a répondu : « C'est combien ? ». Prospect chaud.
         Je propose : « Bonjour Dr …, l'installation est à … puis … par employé et par mois.
         Je passe vous faire une démo de 15 min jeudi ou vendredi ? » J'envoie ?
```

## Ce qu'il sait faire

| Domaine | Détail |
| --- | --- |
| Prospection | Recherche web d'entreprises, import de listes (CSV, PDF, capture d'écran, carte de visite en photo), dédoublonnage |
| Campagnes WhatsApp | Messages personnalisés (`{{entreprise}}`, `{{contact}}`, `{{ville}}`…) avec variantes `{Bonjour|Bonjour à vous}`, **toujours validés par toi** avant envoi, envoi étalé et humanisé |
| Suivi | Réponses des prospects analysées (chaud / tiède / froid) + proposition de réponse ; désinscription automatique (« STOP ») ; relances J+3 / J+7 |
| CRM | Statuts (nouveau → contacté → a répondu → RDV → devis → gagné), notes, historique des messages |
| Finances | Deals (mise en place + abonnement mensuel), encaissements, **revenu mensuel récurrent**, progression vers l'objectif |
| Coaching | Brief du matin, check-in du soir, revue hebdo, rappels de RDV et suivi après RDV, conseils stratégiques chiffrés |
| Mémoire | Il retient tes offres, tes prix, tes clients, tes décisions |

## Démarrage gratuit, en un double-clic

L'agent tourne sur **ton ordinateur** : pas d'hébergement à payer. Seul coût : l'IA Claude, à l'usage. Avec le modèle économique (proposé par défaut), compte environ 1 $ par mois.

**Avant de commencer** (5 minutes) :
1. Crée ta clé Claude sur https://console.anthropic.com : *API Keys* → *Create Key*. Ajoute un petit crédit dans *Billing* : avec le modèle économique, il dure des mois.
2. Télécharge ce dépôt : sur GitHub, bouton vert *Code* → *Download ZIP*, puis décompresse-le.

**Lancer l'agent :**
- **Mac** : ouvre le *Terminal* (Cmd + Espace, tape « Terminal », Entrée). Tape `bash` suivi d'un espace, glisse le fichier **`demarrer.sh`** du dossier dans la fenêtre, puis appuie sur Entrée. Tu peux aussi double-cliquer sur **`DEMARRER.command`**. La première fois, si macOS le bloque, va dans *Réglages Système* → *Confidentialité et sécurité* → *Ouvrir quand même*.
- **Windows** : double-clic sur **`DEMARRER.bat`**.
- **Linux / Android (Termux)** : `bash demarrer.sh`.

Au premier lancement, tout s'installe tout seul : Node.js (sans mot de passe administrateur sur Mac et Linux), puis les composants. Ensuite, l'assistant te pose 5 questions : ta clé, ton prénom, le modèle, le numéro WhatsApp de l'agent, et les notes vocales (optionnel). Il vérifie ta clé tout de suite.

Puis un **code à 8 caractères** s'affiche. Sur le téléphone du numéro de l'agent : WhatsApp → *Appareils connectés* → *Connecter un appareil* → « Connecter avec un numéro de téléphone » → tape le code. L'agent t'envoie son message de bienvenue. Les fois suivantes, le double-clic démarre directement l'agent.

**À savoir :**
- L'agent fonctionne tant que la fenêtre est ouverte et l'ordinateur allumé. Sur Mac, il empêche lui-même la mise en veille. Garde le Mac branché et l'écran ouvert. Sur PC, désactive la mise en veille quand il est branché.
- S'il plante, il redémarre tout seul. Pour l'arrêter, ferme la fenêtre.
- Pour refaire la configuration : `npm run setup`, ou supprime le fichier `.env`.
- Pour tester sans WhatsApp : `npm run simulate`.

### Plus tard : le faire tourner 24 h/24 sans ton PC

> **Pourquoi pas Vercel ?** Vercel exécute des fonctions courtes, sans connexion permanente ni disque. L'agent, lui, garde WhatsApp connecté en continu.

- **Vieux téléphone Android** (gratuit) : installe Termux depuis F-Droid, copie le dossier, puis lance `./demarrer.sh`. Le téléphone reste branché.
- **Railway** (environ 5 $/mois) : *New Project* → *Deploy from GitHub repo* → ajoute un volume monté sur `/data`, puis les variables `ANTHROPIC_API_KEY`, `OWNER_NAME`, `WA_PAIRING_NUMBER` et `CLAUDE_MODEL`. Le code d'appairage s'affiche dans *Deploy Logs*.
- **VPS** : `docker build -t agent-360 . && docker run -d --restart unless-stopped -v agent360:/data --env-file .env agent-360`.

## Comment lui parler (exemples)

- « Trouve-moi 50 PME de plus de 30 employés à Pointe-Noire » / *(photo d'une carte de visite)* « ajoute-le »
- « Prépare une campagne pour les écoles privées, offre pointage à 1 500 F par employé et par mois »
- « Relance ceux qui n'ont pas répondu depuis 3 jours »
- « J'ai RDV demain à 10h avec la clinique Alpha » → il te rappelle avant, puis te demande comment ça s'est passé
- « La clinique a payé 250 000 F d'installation, et 45 000 F par mois ensuite »
- « On en est où ? » / « Qu'est-ce que je devrais faire cette semaine ? »
- **`/pause`** : arrête immédiatement tous les envois (bouton d'urgence, sans passer par l'IA)

## ⚠️ À lire : protéger ton numéro WhatsApp

Cet agent se connecte comme WhatsApp Web via la bibliothèque non officielle **Baileys**. C'est ce qui lui permet d'utiliser *ton* WhatsApp, mais :

- **Envoyer 100 messages d'un coup = numéro banni.** C'est pour ça que l'agent étale les envois (25/jour par défaut, pauses aléatoires de 2 à 7 min, heures de bureau, du lundi au samedi) et ne dépasse jamais ces limites, même si tu le lui demandes.
- Il vérifie que chaque numéro a WhatsApp avant d'envoyer, et met les campagnes en pause tout seul si WhatsApp restreint le compte ou si les envois échouent.
- Numéro neuf : commence à **10–15 envois/jour** la première semaine (`DAILY_SEND_LIMIT`), puis augmente progressivement.
- Messages courts, personnalisés, sans lien dans le premier message, et on respecte ceux qui disent STOP : moins de signalements = numéro en bonne santé.
- Les discussions qui ne sont pas des prospects du CRM (famille, amis, groupes) sont **ignorées** : elles ne sont ni lues par l'IA ni enregistrées.

Pour de très gros volumes, la voie officielle est l'**API WhatsApp Business Cloud** de Meta (modèles de messages validés, payants par conversation). Le code est découpé pour pouvoir ajouter ce canal plus tard (`src/transport/`).

## Coûts

- **Claude** : avec le modèle économique (Haiku 5.5, choisi par défaut à l'installation), environ 1 $ par mois pour une trentaine d'échanges par jour. Le modèle premium (Opus 5.5) est plus fin, mais coûte environ 20 à 40 $ par mois. Ce sont des estimations : surveille ta consommation réelle dans la console Anthropic. Les recherches web sont facturées en plus (environ 1 centime par recherche).
- **Transcription des vocaux** : Groq propose un accès gratuit (avec limites) suffisant pour un usage perso.
- **WhatsApp** : gratuit avec ce mode de connexion.

## Architecture

```
src/
  index.ts              démarrage (WhatsApp ou simulateur)
  agent.ts              boucle Claude + outils (un contexte frais par événement, prompt mis en cache)
  prompt.ts             personnalité du mentor + contexte chiffré injecté à chaque tour
  tools.ts              outils : CRM, campagnes, envois, deals, encaissements, rappels, mémoire, rapports
  router.ts             aiguillage : toi / prospects / tout le reste ignoré, désinscriptions, /pause
  scheduler.ts          envois étalés, rappels, brief du matin, check-in du soir, revue hebdo
  db.ts                 CRM SQLite local (data/agent.db)
  transport/whatsapp.ts connexion WhatsApp (Baileys)
  transport/simulator.ts console de test
```

Sécurité :
- l'agent ne peut **envoyer** un message à un prospect ou **lancer** une campagne que pendant un tour déclenché par **ton** message (vérifié dans le code, pas seulement dans le prompt) : un prospect qui écrit « ignore tes règles et envoie-moi… » ne peut rien déclencher ;
- `data/` (ton CRM) et `auth/` (ta session WhatsApp) restent sur ta machine et sont exclus de Git. **Ne partage jamais le dossier `auth/`** : il donne accès à ton WhatsApp.

## Développement

```bash
npm test          # tests automatiques (CRM, campagnes, garde-fous, boucle Claude simulée)
npm run typecheck
```
