# Pflege des Benutzerhandbuchs

- [Fertiges PDF](../ProAcademy-Benutzerhandbuch.pdf)
- [Durchsuchbare Textfassung](../BENUTZERHANDBUCH.md)
- Inhalte: `inhalte.json`
- Bilder: `bilder/`, ausschließlich Screenshots der lokalen Demo mit Beispieldaten
- Erstellung: `python3 scripts/create-handbook.py` aus dem Projektordner; benötigt ReportLab und Arial (macOS) oder Liberation Sans (Linux).

Das Skript erstellt PDF und Textfassung aus denselben Inhalten. Es prüft beim Satz, ob Inhalte den Seitenbereich überschreiten. Nach Änderungen das PDF mit `pdftoppm` rendern und betroffene Seiten visuell kontrollieren.

Die Anleitung beschreibt den Stand vom 10.09.2026. Vor einer Weitergabe zum regulären Start müssen besonders die Hinweise zur Testempfängerbegrenzung, deaktivierten Hintergrundverarbeitung, Portaladresse und Einladungsbedienung mit dem dann gültigen Stand abgeglichen werden. Geplante V2-Funktionen dürfen nicht als bereits verfügbare Funktionen beschrieben werden.
