# EasyTreno

Web app mobile-first, leggera e immediata per consultare i treni in passaggio dalla stazione di **Vigevano** (e da **Milano S. Cristoforo**, **Milano Scalo Romana**, **Albairate-Vermezzo** o qualsiasi altra stazione italiana).

🌐 **Sito live**: https://cub01d5.github.io/easytreno/

## Funzionalità principali

- **Vista predefinita su Vigevano**: vedi subito i prossimi treni con orario, stato a colori (**verde** in orario, **giallo** ritardo fino a 10 min, **rosso** ritardo oltre 10 min, **nero** cancellato) e **binario** in chiaro.
- **Cambio stazione in 1 tocco**: barra rapida (`Vigevano`, `Milano S. Cristoforo`, `Milano Scalo Romana`, `Albairate-Vermezzo`) + `+ Stazione` per cercare e aggiungere qualsiasi stazione italiana.
- **Orari flessibili in 1 tocco**: `Adesso`, `+1 ora`, `+2 ore`, `Stasera 18:00`, `Domani 07:00`, selettore data/ora e navigazione `Prima` / `Dopo`.
- **Dettaglio fermate**: tocca un treno per vedere tutte le fermate e gli orari lungo la linea.
- **Cerca percorso (Da → A)**: trova collegamenti diretti o con cambi.
- **Live RFI in 1 tocco**: pulsante `Live RFI` in alto per aprire il monitor ufficiale RFI.
- **PWA & Tema chiaro/scuro**: salvabile nella schermata Home su Android e iOS.

## Fonti dati

- **[Transitous](https://transitous.org/)**: API pubblica, gratuita e open-source basata sui feed GTFS ufficiali di **Trenord** e **Trenitalia**.
- **Viaggiatreno (live)**: aggiornato automaticamente ogni 5 minuti via GitHub Actions sul branch `live-data` per ritardi, binari e cancellazioni.
