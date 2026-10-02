# Gottcha

Ein spielbarer Mehrspieler-Prototyp für GPS-Verstecken. Frontend und Echtzeit-Server laufen im selben Node-Prozess; es werden keine npm-Pakete benötigt.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```sh
npm start
```

Öffne anschließend `http://localhost:3000`. GPS ist auf `localhost` für Entwicklung erlaubt. Für andere Geräte oder Freunde braucht die App eine öffentlich erreichbare HTTPS-Adresse; dadurch verwendet sie automatisch WebSockets über `wss://`. Die Web-App lässt sich am iPhone über Safari zum Home-Bildschirm hinzufügen und auf Android über das Browsermenü installieren. Standort und GPS-Live-Updates funktionieren nur, solange das Gerät die Website aktiv ausführt; Hintergrundbetrieb ist keine native App-Funktion.

## So funktioniert eine Runde

1. Der Ersteller erlaubt seinen Standort, wählt Regeln und erstellt einen Raum.
2. Freunde erlauben ebenfalls Standort und treten mit dem sechsstelligen Code bei.
3. In der Lobby kann jeder die Rolle wechseln. Der Ersteller startet, sobald mindestens ein Sucher und ein Versteckter dabei sind.
4. Die Karte zeigt die echte Spielzone als Kreis um den GPS-Standort des Erstellers. Radius und Shrink-Endgröße sind einstellbar.
5. Suchende sehen die Standorte der Versteckten nur kurz während der regelmäßigen Standort-Pings. Eigene Positionen bleiben sichtbar; Versteckte sehen die Positionen der Suchenden nicht.
6. Automatisches Fangen passiert serverseitig innerhalb des eingestellten Abstands. Im manuellen Modus meldet der Sucher den Fang per Knopfdruck; der Server prüft ebenfalls den Abstand.

## Online hosten

Der Host muss Node.js unterstützen, WebSocket-Upgrades durchlassen und HTTPS/WSS bereitstellen. `render.yaml` enthält eine Render-Konfiguration für einen kostenlosen Start; nach dem Verbinden eines GitHub-Repositories kann Render die Datei als Blueprint einlesen. Render setzt `RENDER_EXTERNAL_URL`, das der Server für den WebSocket-Origin-Check verwendet. Stelle für einen ersten Server genau **eine laufende Instanz** ein: Spielräume und aktuelle Standorte liegen absichtlich nur im Arbeitsspeicher des Prozesses. Ein Neustart beendet alle aktiven Runden. Ein Host mit mehreren parallelen Instanzen braucht eine gemeinsame Echtzeit-Datenbank oder einen Durable-Object/WebSocket-Dienst.

Setze in Produktion:

```text
NODE_ENV=production
PORT=<vom Host vorgegeben>
HOST=0.0.0.0
APP_ORIGIN=https://<genaue-app-domain>
```

`APP_ORIGIN` muss exakt der Website-Origin entsprechen, zum Beispiel `https://spiel.example`; der Server weist WebSocket-Verbindungen von anderen Origins zurück. Bewahre den Wert als Server-Umgebungsvariable auf, nicht im Browsercode.

`Dockerfile` ist als Container-Einstieg vorhanden. Plattformen, die nur statische Dateien oder serverlose Kurzaufrufe hosten, reichen für den Echtzeit-Server nicht aus.

## Kartenmaterial

Die Karte nutzt Leaflet und sichtbare OpenStreetMap-Kacheln mit Quellenangabe. Die öffentlichen OSM-Kachelserver werden gemeinschaftlich finanziert und haben keine Verfügbarkeitsgarantie. Für viele Spieler oder einen öffentlichen Produktivbetrieb sollte ein geeigneter Kartenanbieter eingerichtet werden; Leaflet erlaubt den Wechsel des Kachelproviders.

## Datenschutz und Grenzen

- Das Backend speichert Namen, Rollen und aktuelle Koordinaten nur im laufenden Prozessspeicher.
- Koordinaten werden nach dem Beitritt zur Lobby und während der Runde an den Spielserver übertragen. Der Server gibt Suchern Hider-Positionen nur während eines Pings frei.
- Wenn eine Runde endet, der Nutzer die Runde verlässt oder die Verbindung abbricht, stoppt der Browser die Standortfreigabe.
- Browser-GPS ist nicht fälschungssicher und kann je nach Gerät ungenau sein.
- Der Prototyp enthält keine Konten, dauerhafte Spielhistorie, Push-Nachrichten oder native iOS/Android-Installationspakete.

## Kurztest

Erstelle in einem Browser eine Lobby und tritt ihr von einem zweiten Browser/Fenster mit dem Code bei. Für GPS auf echten Geräten muss die öffentliche Adresse HTTPS verwenden. In automatisierten Checks wurden Raum-Erstellung, Beitritt, rollenbasierte Standortfreigabe und beide Fangmodi geprüft.
