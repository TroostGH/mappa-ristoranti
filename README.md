# 🌱 Mappa Ristoranti — guida setup

Web app personale per tenere traccia dei ristoranti **vegan** in cui sei stato (o vuoi provare).
- Frontend statico (HTML/CSS/JS) → hostato gratis su **GitHub Pages**
- Database → **Firebase Firestore** (free tier)
- Ricerca e mappa → **Google Maps + Places API**
- 229 ristoranti vegan pre-caricati dal tuo export mapstr

---

## Cosa c'è in questa cartella

```
web-app/
├── index.html         ← l'app principale
├── app.js             ← logica (Firebase + Google Maps + UI)
├── styles.css         ← stili
├── config.js          ← ⚠️ DA COMPILARE: chiavi Firebase + Google Maps
├── seed.html          ← pagina one-shot per popolare Firestore coi 229 ristoranti
├── seed-data/
│   └── restaurants-seed.json    ← i 229 ristoranti vegan filtrati dall'export
└── README.md          ← questo file
```

---

## Step 1 — Crea il progetto Firebase

1. Vai su <https://console.firebase.google.com> (sei già loggato col tuo account).
2. **Add project** → nome a piacere (es. `mappa-ristoranti`) → disabilita Google Analytics → Create.
3. Nel menu di sinistra: **Build → Firestore Database** → **Create database**.
   - Modalità: **Start in production mode**
   - Location: `eur3 (europe-west)` (o quella più vicina a te)
4. Vai sulla scheda **Rules** e incolla queste regole (app pubblica come hai chiesto):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /restaurants/{doc} {
         allow read, write: if true;
       }
     }
   }
   ```

   > ⚠️ Tieni a mente: queste regole permettono a **chiunque** col link di scrivere/cancellare. Se in futuro vorrai proteggere la scrittura, basta aggiungere Firebase Auth e cambiare la regola in `allow write: if request.auth != null`.

5. **Project settings** (ingranaggio in alto a sinistra) → scheda **General** → scorri fino a **Your apps** → icona `</>` (Web).
6. Registra l'app con un nickname (`mappa-ristoranti-web`), **non** abilitare Firebase Hosting.
7. Copia il blocco `firebaseConfig` mostrato e incollalo in `config.js` (sostituisci la sezione `firebaseConfig`).

---

## Step 2 — Crea la chiave Google Maps API

1. Vai su <https://console.cloud.google.com> (stesso account Google).
2. Crea un nuovo progetto (puoi anche usare quello creato automaticamente da Firebase).
3. **APIs & Services → Library** → cerca e abilita:
   - **Maps JavaScript API**
   - **Places API** (la versione "legacy" / non "New" va benissimo)
4. **Billing**: ti chiederà di attivare la fatturazione → serve una carta di credito.
   - **Non preoccuparti**: Google offre $200 di credito gratuito al mese, che basta per **decine di migliaia** di caricamenti mappa. Per uso personale rimani sempre nel free tier.
5. **APIs & Services → Credentials → Create credentials → API key**.
6. Copia la chiave e incollala in `config.js` come valore di `GOOGLE_MAPS_API_KEY`.
7. **IMPORTANTE — restringi la chiave** per evitare abusi:
   - Clicca sulla chiave appena creata → **Application restrictions**: scegli **Websites**.
   - Aggiungi questi referrer:
     - `http://localhost/*` (per testare in locale)
     - `https://TUO-USER.github.io/*` (sostituisci con il tuo username GitHub)
   - **API restrictions**: limita alle sole **Maps JavaScript API** e **Places API**.
   - Save.

---

## Step 3 — Carica su GitHub e abilita Pages

1. Vai su <https://github.com/new> (sei già loggato).
2. Crea un repo nuovo, es. `mappa-ristoranti` — pubblico (richiesto per GitHub Pages free).
3. Carica tutti i file della cartella `web-app/` (può fare drag&drop direttamente nel browser su GitHub):
   - `index.html`, `app.js`, `styles.css`, `config.js`, `seed.html`
   - cartella `seed-data/` (con `restaurants-seed.json` dentro)
4. Nel repo → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: `main` / `/ (root)` → Save.
5. Dopo 1-2 minuti l'app sarà online a `https://TUO-USER.github.io/mappa-ristoranti/`.

---

## Step 4 — Popola Firestore (una sola volta)

1. Apri `https://TUO-USER.github.io/mappa-ristoranti/seed.html`.
2. Clicca **🚀 Importa 229 ristoranti su Firestore**.
3. Aspetta il messaggio "✅ Importazione completata".
4. **Cancella o rinomina** `seed.html` dal repo per evitare reimportazioni accidentali (es. rinomina in `_seed.html.bak`).

---

## Step 5 — Apri l'app!

Vai su `https://TUO-USER.github.io/mappa-ristoranti/` — vedrai i 229 ristoranti già caricati.

### Cosa puoi fare:
- 📋 **Elenco**: lista filtrabile per testo e per tag (clicca un tag per filtrare).
- 🗺️ **Mappa**: vista geografica con bollini gialli; clicca un bollino → info + link "Navigazione".
- ➕ **Aggiungi**: cerca un ristorante per nome → ti escono i risultati di Google Maps → clicchi quello giusto → personalizzi tag e nota → salvi.
- Su ogni card hai un bottone **🧭 Indicazioni** che apre direttamente Google Maps in modalità navigazione verso il ristorante.
- Apri il dettaglio (click sulla card) per rimuovere un ristorante dall'elenco.

---

## Costi previsti

| Servizio | Limite gratuito | Uso previsto | Costo |
|---|---|---|---|
| GitHub Pages | 100 GB banda/mese | Centinaia di MB | **€0** |
| Firebase Firestore | 50k letture, 20k scritture/giorno | Decine al giorno | **€0** |
| Google Maps + Places | $200 credito/mese ≈ 28.000 caricamenti | Centinaia | **€0** |

> Per non avere brutte sorprese, in Google Cloud puoi impostare un **budget alert** (Billing → Budgets & alerts) che ti avvisa via email se ti avvicini a 5 €.

---

## Troubleshooting

- **"Errore di caricamento — controlla la configurazione Firebase"** → `firebaseConfig` non compilato correttamente in `config.js`, o le regole Firestore non permettono read.
- **Mappa vuota / errore "RefererNotAllowedMapError"** → la chiave Maps ha restrizioni HTTP referrer che non includono il tuo dominio GitHub Pages. Vai su Google Cloud Console e aggiungi `https://TUO-USER.github.io/*`.
- **Mappa vuota / "BillingNotEnabledMapError"** → devi attivare il billing in Google Cloud (con carta), poi i $200/mese gratuiti coprono l'uso.
- **Ricerca "Aggiungi" non funziona** → controlla che **Places API** sia abilitata in Google Cloud Console.

---

Buon appetito! 🌱🍕🍝
