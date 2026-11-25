# EasyTreno

Web app mobile-first, leggera e immediata per consultare i treni in passaggio dalla stazione di **Vigevano** (e da qualsiasi altra stazione italiana **Trenord** e **Trenitalia**).

🌐 **Sito live**: https://cub01d5.github.io/easytreno/

## Funzionalità principali

- **Vista predefinita immediata su Vigevano**: apri il sito e vedi subito i prossimi treni in partenza/passaggio con conto alla rovescia e filtro rapido per direzione (`→ Milano Rogoredo`, `→ Mortara`, ecc.).
- **Cambio stazione in 1 tocco**: barra rapida con le tue stazioni preferite + ricerca istantanea di tutte le stazioni italiane (puoi aggiungere, rimuovere o impostare la tua stazione principale).
- **Orari flessibili in 1 tocco**: `Adesso`, `+1 ora`, `+2 ore`, `Stasera 18:00`, `Domani 07:00`, selettore data/ora personalizzato e navigazione `Prima` / `Dopo`.
- **Dettaglio fermate**: tocca un treno per vedere tutte le fermate e gli orari lungo la linea, con salto rapido al tabellone di qualsiasi fermata.
- **Cerca percorso (Da → A)**: trova subito collegamenti diretti o con cambi (es. Vigevano → Milano Rogoredo / Milano Centrale / Mortara).
- **Monitor Live RFI in 1 tocco**: pulsante `Live RFI` nell'intestazione per aprire direttamente il monitor ufficiale RFI con ritardi e binari in tempo reale.
- **PWA & Tema scuro**: salvabile nella schermata Home su Android e iOS, con supporto tema chiaro/scuro.

## Fonti dati (pubbliche e gratuite)

- **[Transitous](https://transitous.org/)**: servizio pubblico, gratuito e open-source basato su MOTIS che aggrega i feed GTFS ufficiali di **Trenord** e **Trenitalia** via HTTPS con supporto CORS nativo (senza chiave API).
- **RFI Arrivi & Partenze Live**: collegamento diretto ai monitor ufficiali di Rete Ferroviaria Italiana.

## Ritardi e binari live inline (opzionale)

Le API Viaggiatreno di Trenitalia sono solo HTTP e senza intestazioni CORS, quindi i browser bloccano le richieste dirette da pagine HTTPS come GitHub Pages.

Se vuoi mostrare ritardi (`+6 min`) e binari (`Bin. 1`) live di Viaggiatreno **direttamente dentro le card** di EasyTreno:

1. Crea un Cloudflare Worker gratuito usando il file [`worker/viaggiatreno-proxy.js`](./worker/viaggiatreno-proxy.js).
2. Apri **Impostazioni (⚙️)** su EasyTreno e incolla l'URL del tuo Worker (es. `https://easytreno-proxy.tuo-account.workers.dev`).
