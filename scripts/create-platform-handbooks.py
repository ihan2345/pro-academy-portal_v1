#!/usr/bin/env python3
"""Create platform PDFs/Markdown and mirror this documentation bundle to Portal.

No network calls, application changes, emails, Git operations or deployments.
"""
from pathlib import Path
import hashlib
import html
import json
import re
import shutil
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/plattform-handbuecher'
DATA = json.loads((OUT / 'inhalte.json').read_text())
DEST = Path(DATA['export_directory'])
FONT = Path('/System/Library/Fonts/Supplemental')
regular, bold = FONT / 'Arial.ttf', FONT / 'Arial Bold.ttf'
if not regular.exists():
    FONT = Path('/usr/share/fonts/truetype/liberation2')
    regular, bold = FONT / 'LiberationSans-Regular.ttf', FONT / 'LiberationSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('Guide', str(regular)))
pdfmetrics.registerFont(TTFont('Guide-Bold', str(bold)))
pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='Guide-Bold', italic='Guide', boldItalic='Guide-Bold')
W, H, M = 595.28, 841.89, 44
CW = W - 2*M
DARK, LIME, PURPLE, MUTED = map(HexColor, ['#121A26', '#96F500', '#6840BC', '#526071'])
styles = {
    'p': ParagraphStyle('p', fontName='Guide', fontSize=13.5, leading=18.5, textColor=DARK),
    'sub': ParagraphStyle('sub', fontName='Guide-Bold', fontSize=16, leading=21, textColor=DARK),
    'tip': ParagraphStyle('tip', fontName='Guide', fontSize=13, leading=18, textColor=DARK),
    'source': ParagraphStyle('source', fontName='Guide', fontSize=10.5, leading=14.5, textColor=MUTED),
    'cell': ParagraphStyle('cell', fontName='Guide', fontSize=12.5, leading=17, textColor=DARK),
    'title': ParagraphStyle('title', fontName='Guide-Bold', fontSize=26, leading=31, textColor=DARK),
    'code': ParagraphStyle('code', fontName='Courier', fontSize=10.5, leading=15, textColor=DARK),
}

def markdown(text):
    text = re.sub(r'<link href="([^"]+)"[^>]*>(.*?)</link>', r'[\2](\1)', text)
    text = re.sub(r'<b>(.*?)</b>', r'**\1**', text)
    return html.unescape(text.replace('<br/>', '\n'))

class PDF:
    def __init__(self, manual):
        self.manual = manual
        self.c = canvas.Canvas(str(OUT / (manual['file']+'.pdf')), pagesize=(W,H))
        self.c.setTitle('ProAcademy | '+manual['name'])
        self.c.setAuthor('ProAcademy by Ayhan & Karaman')
        self.c.setSubject('Einfaches Plattform-Handbuch mit Projektabläufen und Checklisten')
    def ensure(self, h):
        if self.y-h < 54:
            raise RuntimeError(f'{self.manual["file"]}, Seite {self.n}: Überlauf {54-self.y+h:.1f} pt')
    def para(self, text, style='p', indent=0, space=10):
        p = Paragraph(text, styles[style]); _,h = p.wrap(CW-indent,H)
        self.ensure(h); p.drawOn(self.c,M+indent,self.y-h); self.y-=h+space
    def box(self, text, code=False):
        if code:
            text = '<br/>'.join(html.escape(line).replace(' ', '&#160;') for line in text.splitlines())
        p=Paragraph(text,styles['code' if code else 'tip']); _,h=p.wrap(CW-28,H)
        self.ensure(h+24); c=self.c
        c.setFillColor(HexColor('#F0F3F7' if code else '#F2F5ED'))
        c.roundRect(M,self.y-h-24,CW,h+24,7,fill=1,stroke=0)
        c.setFillColor(PURPLE if code else LIME); c.rect(M,self.y-h-24,4,h+24,fill=1,stroke=0)
        p.drawOn(c,M+14,self.y-h-12); self.y-=h+36
    def table(self, rows):
        cols=len(rows[0]); widths=[CW*.38,CW*.62] if cols==2 else [CW*.46,CW*.27,CW*.27]
        cells=[[Paragraph(('<b>'+html.escape(v)+'</b>') if i==0 else html.escape(v),styles['cell']) for v in row] for i,row in enumerate(rows)]
        t=Table(cells,colWidths=widths)
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#EAF2E2')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.5,HexColor('#DAE1E8'))]))
        _,h=t.wrap(CW,H); self.ensure(h);t.drawOn(self.c,M,self.y-h);self.y-=h+13
    def build(self):
        c=self.c
        for self.n,page in enumerate(self.manual['pages'],1):
            c.bookmarkPage(f'p{self.n}');c.addOutlineEntry(page['title'],f'p{self.n}',0)
            c.setFillColor(PURPLE);c.setFont('Guide-Bold',10);c.drawString(M,H-32,self.manual['name'].upper())
            c.setFillColor(MUTED);c.setFont('Guide',9);c.drawRightString(W-M,H-32,page.get('role','ADMINISTRATION'))
            self.y=H-56;self.para(page['title'],'title',space=16)
            if self.n==1:
                c.setFillColor(DARK);c.roundRect(M,self.y-69,CW,69,8,fill=1,stroke=0)
                logo=ImageReader(str(ROOT/'public/brand/logo-neon.png'));iw,ih=logo.getSize()
                c.drawImage(logo,M+14,self.y-60,width=49*iw/ih,height=49,mask='auto')
                c.setFillColor(white);c.setFont('Guide-Bold',14);c.drawString(M+74,self.y-28,'PROACADEMY')
                c.setFont('Guide',11);c.drawString(M+74,self.y-47,'Einfach erklärt. Zum Nachschlagen und Ausdrucken.')
                self.y-=84
            for b in page['blocks']:
                kind=b['type']
                if kind in ('p','sub','source'): self.para(b['text'],kind)
                elif kind in ('tip','code'): self.box(b['text'],kind=='code')
                elif kind=='table': self.table(b['rows'])
                elif kind=='step':
                    c.setFillColor(PURPLE);c.circle(M+10,self.y-10,10,fill=1,stroke=0)
                    c.setFillColor(white);c.setFont('Guide-Bold',11);c.drawCentredString(M+10,self.y-14,str(b['n']))
                    self.para(b['text'],indent=30,space=12)
                elif kind=='check':
                    c.setStrokeColor(PURPLE);c.setLineWidth(1);c.rect(M,self.y-13,11,11,fill=0,stroke=1)
                    self.para(b['text'],indent=23,space=10)
                else: raise ValueError(kind)
            c.setStrokeColor(HexColor('#DCE1E6'));c.line(M,39,W-M,39)
            c.setFillColor(MUTED);c.setFont('Guide',9);c.drawString(M,24,'ProAcademy · Stand '+DATA['date'])
            c.drawRightString(W-M,24,f'{self.n} / {len(self.manual["pages"])}')
            print(f'{self.manual["file"]} Seite {self.n}: {self.y-54:.0f} pt frei')
            c.showPage()
        c.save()

managed=['inhalte.json']
for manual in DATA['manuals']:
    PDF(manual).build()
    lines=['# ProAcademy | '+manual['name'],'', 'Stand: '+DATA['date']+'.', '', '[PDF öffnen]('+manual['file']+'.pdf)', '']
    for i,page in enumerate(manual['pages'],1):
        lines += [f'## {i}. {page["title"]}', '', '**'+page.get('role','Administration')+'**','']
        for b in page['blocks']:
            kind=b['type']
            if kind=='code':lines += ['```sh' if not b.get('language') else '```'+b['language'],b['text'],'```','']
            elif kind=='table':
                rows=b['rows'];lines += ['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(r)+' |' for r in rows[1:]]+['']
            else:
                prefix={'sub':'### ','tip':'> ','source':'Quelle / Grundlage: ','check':'- [ ] ','step':str(b.get('n',''))+'. '}.get(kind,'')
                lines += [prefix+markdown(b['text']),'']
    (OUT/(manual['file']+'.md')).write_text('\n'.join(lines))
    managed += [manual['file']+'.pdf',manual['file']+'.md']

index=['# ProAcademy: Plattform-Handbücher','','Stand: '+DATA['date']+'. Für Mitarbeiter zum Verständnis und für autorisierte Administratoren zum Nachschlagen.','', 'Mit **00-Start-hier** beginnen. Jedes Handbuch ist einzeln lesbar und druckbar. Die PDF-Dateien enthalten große Schrift, nummerierte Abläufe und eine Abschlusscheckliste.','', '| Handbuch | PDF | Textfassung |','| --- | --- | --- |']
for m in DATA['manuals']:
    index.append(f'| {m["name"]} | [PDF]({m["file"]}.pdf) | [Markdown]({m["file"]}.md) |')
index += ['', '## Aktueller Betriebsstand', '', '- Veröffentlichung nur auf ausdrücklichen Deploy-Befehl.', '- Ausschließlich die Worker-Adresse verwenden; portal.proacademy-ak.com bleibt inaktiv.', '- Automatische Jobs und allgemeiner Elternversand bleiben gesperrt. Die Supabase-Datenbank und das Stripe-Konto sind echte Produktionssysteme.', '- Diese Dokumentation wurde aus Projektdateien und offiziellen Anleitungen erstellt. Sie ist kein erneuter Live-Funktionstest. Plattformoberflächen können ihre Beschriftungen ändern.', '', '## Pflege und automatische Kopie', '', 'Die Quelle ist `inhalte.json`. Aus dem Projektordner ausführen:', '', '```sh', 'python3 scripts/create-platform-handbooks.py', '```', '', 'Der Befehl erzeugt alle PDFs und Textfassungen im Projekt und kopiert das Dokumentationspaket automatisch nach:', '', '`'+str(DEST)+'`', '', 'Anschließend werden die SHA-256-Prüfsummen beider Ablagen verglichen. `EXPORT-NACHWEIS.json` dokumentiert die Dateien. Es gibt keinen permanenten Ordnerabgleich; Änderungen werden bei der nächsten Erstellung erneut kopiert. Unbeteiligte Dateien werden nicht gelöscht.', '', 'Das Kopieren ist weder ein Git-Push noch ein App-Deployment. Im Paket stehen keine Passwörter oder geheimen Schlüssel.', '', 'Für die technische Pflege im Projekt: `wrangler.jsonc`, `workers/cloudflare/wrangler.jsonc`, `docs/TARIFF-RULES.md`, `docs/ARCHITECTURE.md` und die neuesten Einträge in `docs/LAUNCH-SETUP.md`. Ältere Einträge der Launch-Dokumentation beschreiben historische Zwischenstände.','']
(OUT/'README.md').write_text('\n'.join(index));managed.append('README.md')
DEST.mkdir(parents=True,exist_ok=True)
hashes={}
for name in managed:
    source=OUT/name;dest=DEST/name
    if source.resolve()!=dest.resolve():shutil.copy2(source,dest)
    expected=hashlib.sha256(source.read_bytes()).hexdigest()
    actual=hashlib.sha256(dest.read_bytes()).hexdigest()
    if actual!=expected:raise RuntimeError('Kopie stimmt nicht überein: '+name)
    hashes[name]=expected
manifest={'stand':DATA['date'],'project_directory':str(OUT),'export_directory':str(DEST),'sha256':hashes}
for directory in (OUT,DEST):
    (directory/'EXPORT-NACHWEIS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'{len(managed)} Dateien erstellt und identisch kopiert nach {DEST}')
