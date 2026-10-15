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

## Installation (15 minutes)

Prérequis : **Node.js 22.13 ou plus récent** et une **clé API Claude** (https://console.anthropic.com → API Keys, avec quelques dollars de crédit).

```bash
cd agent-360
npm install
cp .env.example .env      # puis ouvre .env et colle ta clé ANTHROPIC_API_KEY
```

### 1. Teste d'abord dans la console (sans WhatsApp)

```bash
npm run simulate
```

Écris comme si tu étais sur WhatsApp. Pour simuler un prospect qui répond : `/prospect 242061234567 Oui c'est combien ?`. Le simulateur utilise une base séparée (`data/simulation.db`) : tes essais ne polluent pas ton vrai CRM.

### 2. Branche WhatsApp

```bash
npm start
```

Un QR code s'affiche : sur ton téléphone, **WhatsApp → Appareils connectés → Connecter un appareil**, puis scanne. (Sur un serveur sans écran : mets ton numéro dans `WA_PAIRING_NUMBER`, tu recevras un code à saisir via « Connecter avec un numéro de téléphone ».)

Ensuite, parle à l'agent dans la discussion **« Moi (Vous) »** (le chat avec toi-même). Il se présente au premier démarrage.

**Configuration recommandée** : un **2e numéro dédié** (WhatsApp Business) pour l'agent et la prospection. Mets ton numéro perso dans `OWNER_NUMBERS` et tu lui écris comme à un contact normal. Si ce numéro est un jour restreint par WhatsApp, ton numéro perso n'est pas touché.

### 3. Fais-le tourner 24 h/24

Les rituels, rappels et envois ne marchent que si l'agent tourne en continu.

> **Pourquoi pas Vercel ?** Vercel exécute des fonctions courtes qui s'arrêtent après chaque requête, sans disque permanent. Or l'agent garde une connexion WhatsApp ouverte en permanence et stocke son CRM et sa session sur disque : sur Vercel, il serait déconnecté en quelques secondes. Railway donne la même expérience que Vercel (tu connectes GitHub, chaque push redéploie), mais pour les programmes qui tournent 24 h/24.

**Option recommandée : Railway** (plan Hobby, environ 5 $/mois)

1. Crée un compte sur https://railway.com et connecte ton GitHub.
2. *New Project → Deploy from GitHub repo* → choisis le dépôt de l'agent. Railway détecte le `Dockerfile` tout seul. (Si l'agent est encore dans le dépôt mowbara, mets `agent-360` comme *Root Directory* dans *Settings*.)
3. Dans le service : *Settings → Volumes → Add Volume*, chemin de montage **`/data`**. Ton CRM et ta session WhatsApp y sont conservés entre deux redéploiements.
4. Onglet *Variables* : ajoute au minimum `ANTHROPIC_API_KEY`, `OWNER_NAME`, et **`WA_PAIRING_NUMBER`** (le numéro WhatsApp que l'agent va utiliser, ex. `242061234567`). Ajoute les autres réglages de `.env.example` si besoin.
5. Déploie, puis ouvre l'onglet *Deploy Logs* : un **code d'appairage** à 8 caractères s'affiche. Sur le téléphone : WhatsApp → Appareils connectés → Connecter un appareil → « Connecter avec un numéro de téléphone », et saisis le code.
6. C'est tout : l'agent t'écrit son message de bienvenue sur WhatsApp.

**Autres options**

- Un VPS (Hetzner, Contabo… ≈ 5 €/mois) : `docker build -t agent-360 . && docker run -d --restart unless-stopped -v agent360:/data --env-file .env agent-360`, ou sans Docker :
  ```bash
  npm install -g pm2
  pm2 start npm --name agent-360 -- start
  pm2 save && pm2 startup
  ```
- Ton PC : `npm start` marche, mais l'agent s'arrête quand le PC s'éteint ou se met en veille.

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

- **Claude** : avec le modèle par défaut (Opus 5.5) et un usage normal (une trentaine d'échanges par jour), compte grossièrement 15 000 à 30 000 FCFA par mois. C'est une estimation : surveille ta consommation réelle dans la console Anthropic. `CLAUDE_MODEL=claude-sonnet-5-5` divise le coût par deux environ. Les recherches web sont facturées en plus.
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
