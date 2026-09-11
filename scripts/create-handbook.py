#!/usr/bin/env python3
"""Build the printable handbook from docs/handbuch/inhalte.json; no external access."""
from pathlib import Path
import json, re, html
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/handbuch/inhalte.json'
OUT=ROOT/'docs/ProAcademy-Benutzerhandbuch.pdf'
DATA=json.loads(SOURCE.read_text())
font_dir=Path('/System/Library/Fonts/Supplemental')
# Use bundled Arial on macOS, or Liberation Sans on Linux.
regular=font_dir/'Arial.ttf'; bold=font_dir/'Arial Bold.ttf'
if not regular.exists():
    regular=Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf')
    bold=Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf')
pdfmetrics.registerFont(TTFont('Guide',str(regular)))
pdfmetrics.registerFont(TTFont('Guide-Bold',str(bold)))
pdfmetrics.registerFontFamily('Guide',normal='Guide',bold='Guide-Bold',italic='Guide',boldItalic='Guide-Bold')
W,H=595.28,841.89; M=44; CW=W-2*M
DARK=HexColor('#121A26'); LIME=HexColor('#96F500'); PURPLE=HexColor('#6840BC'); MUTED=HexColor('#526071')
styles={
    'p':ParagraphStyle('body',fontName='Guide',fontSize=14,leading=19.5,textColor=DARK),
    'sub':ParagraphStyle('sub',fontName='Guide-Bold',fontSize=17,leading=22,textColor=DARK),
    'tip':ParagraphStyle('tip',fontName='Guide',fontSize=13,leading=18,textColor=DARK),
    'small':ParagraphStyle('small',fontName='Guide',fontSize=10,leading=14,textColor=MUTED),
    'cell':ParagraphStyle('cell',fontName='Guide',fontSize=12.5,leading=17,textColor=DARK),
    'title':ParagraphStyle('title',fontName='Guide-Bold',fontSize=27,leading=32,textColor=DARK),
}
c=canvas.Canvas(str(OUT),pagesize=(W,H)); c.setTitle(DATA['title']);c.setAuthor('ProAcademy by Ayhan & Karaman');c.setSubject('Schritt-für-Schritt-Anleitung für Coaches, Mitarbeiter und Admins')
y=0; page_no=0

def ensure(height):
    if y-height<51: raise RuntimeError(f'Seite {page_no}: Inhalt überschreitet Satzspiegel um {51-(y-height):.1f} pt')
def para(text,style='p',indent=0,space=10,width=None):
    global y
    box=Paragraph(text,styles[style]); aw=width or CW-indent
    _,height=box.wrap(aw,H);ensure(height)
    box.drawOn(c,M+indent,y-height);y-=height+space

def picture(name,maxheight):
    global y
    image=ImageReader(str(ROOT/'docs/handbuch/bilder'/f'{name}.png')); iw,ih=image.getSize()
    width=min(CW, maxheight*iw/ih); height=width*ih/iw
    ensure(height+24)
    x=M+(CW-width)/2
    c.setStrokeColor(HexColor('#D7DEE7'));c.setLineWidth(.6);c.roundRect(x-1,y-height-1,width+2,height+2,5,fill=0,stroke=1)
    c.drawImage(image,x,y-height,width=width,height=height,mask='auto')
    y-=height+5
    para('Ansicht mit Beispieldaten.','small',space=10)

def table(rows):
    global y
    widths=[CW*.60,CW*.20,CW*.20] if len(rows[0])==3 else [CW*.43,CW*.57]
    contents=[[Paragraph(f'<b>{html.escape(t)}</b>' if j==0 else html.escape(t),styles['cell']) for t in row] for j,row in enumerate(rows)]
    t=Table(contents,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#EAF2E2')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),.5,HexColor('#DAE1E8'))]))
    _,height=t.wrap(CW,H);ensure(height);t.drawOn(c,M,y-height);y-=height+14

def tip(text):
    global y
    par=Paragraph(text,styles['tip']); _,h=par.wrap(CW-28,H);height=h+24;ensure(height)
    c.setFillColor(HexColor('#F2F5ED'));c.roundRect(M,y-height,CW,height,7,fill=1,stroke=0)
    c.setFillColor(LIME);c.rect(M,y-height,4,height,fill=1,stroke=0)
    par.drawOn(c,M+14,y-12-h);y-=height+12

def step(n,text):
    global y
    c.setFillColor(PURPLE);c.circle(M+10,y-10,10,fill=1,stroke=0)
    c.setFillColor(white);c.setFont('Guide-Bold',11);c.drawCentredString(M+10,y-14,str(n))
    para(text,indent=30,space=11)

def cover():
    global y
    height=182;ensure(height)
    c.setFillColor(DARK);c.roundRect(M,y-height,CW,height,10,fill=1,stroke=0)
    logo=ImageReader(str(ROOT/'public/brand/logo-neon.png'));iw,ih=logo.getSize()
    c.drawImage(logo,M+24,y-148,width=110*iw/ih,height=110,mask='auto')
    c.setFillColor(white);c.setFont('Guide-Bold',19);c.drawString(M+150,y-42,'Dein Portalzugang')
    c.setFont('Guide',12);c.drawString(M+150,y-64,'Im Browser öffnen oder QR-Code scannen.')
    c.setFillColor(LIME);c.setFont('Guide-Bold',14);c.drawString(M+150,y-98,'ProAcademy-Portal öffnen')
    c.linkURL(DATA['portal'],(M+148,y-108,M+366,y-82),relative=0)
    c.setFillColor(HexColor('#BCC8D4'));c.setFont('Guide',10);c.drawString(M+150,y-127,'Aktuelle Adresse: Cloudflare-Worker-Link')
    qr=QrCodeWidget(DATA['portal']);b=qr.getBounds();size=64
    drawing=Drawing(size,size,transform=[size/(b[2]-b[0]),0,0,size/(b[3]-b[1]),0,0]);drawing.add(qr)
    c.setFillColor(white);c.rect(M+CW-94,y-169,76,76,fill=1,stroke=0)
    renderPDF.draw(drawing,c,M+CW-88,y-163)
    y-=height+17

def menu():
    global y
    ensure(172)
    im=ImageReader(str(ROOT/'docs/handbuch/bilder/coach-menue.png'));iw,ih=im.getSize();h=164;w=h*iw/ih
    c.drawImage(im,M,y-h,width=w,height=h)
    text='<b>Trainingsplanung</b><br/>Termine anlegen, bearbeiten und Ausnahmen eintragen.<br/><br/><b>Stempelkarten</b><br/>Kinder und Zeiträume prüfen, PDF exportieren und Mailauftrag vormerken.'
    box=Paragraph(text,styles['tip']); _,ph=box.wrap(CW-w-24,H);box.drawOn(c,M+w+24,y-ph)
    y-=max(h,ph)+12

for page_no,page in enumerate(DATA['pages'],1):
    c.bookmarkPage(f'page-{page_no}');c.addOutlineEntry(page['title'],f'page-{page_no}',level=0)
    c.setFillColor(PURPLE);c.setFont('Guide-Bold',10);c.drawString(M,H-34,page['role'])
    c.setFillColor(MUTED);c.setFont('Guide',9);c.drawRightString(W-M,H-34,'PROACADEMY · HANDBUCH')
    y=H-57
    para(page['title'],'title',space=17)
    for block in page['blocks']:
        kind=block['type']
        if kind=='p':para(block['text'])
        elif kind=='sub':para(block['text'],'sub',space=9)
        elif kind=='step':step(block['n'],block['text'])
        elif kind=='tip':tip(block['text'])
        elif kind=='image':picture(block['name'],block['height'])
        elif kind=='table':table(block['rows'])
        elif kind=='cover':cover()
        elif kind=='menu':menu()
        elif kind=='check':
            c.setStrokeColor(PURPLE);c.setLineWidth(1);c.rect(M,y-13,11,11,fill=0,stroke=1);para(block['text'],indent=23,space=9)
    c.setStrokeColor(HexColor('#DCE1E6'));c.line(M,39,W-M,39)
    c.setFillColor(MUTED);c.setFont('Guide',9);c.drawString(M,24,'ProAcademy by Ayhan & Karaman · Stand '+DATA['date'])
    c.drawRightString(W-M,24,f'{page_no} / {len(DATA["pages"])}')
    print(f'Seite {page_no}: freier Platz {y-51:.0f} pt')
    c.showPage()
c.save()
# Text version for searching and future maintenance, generated from the same source.
def md(text):
    text=re.sub(r'<b>(.*?)</b>',r'**\1**',text);text=text.replace('<br/>','\n');return html.unescape(text)
lines=['# ProAcademy Benutzerhandbuch','',f'Stand: {DATA["date"]}. Für Coaches, Mitarbeiter und Admins.','', '[PDF öffnen](ProAcademy-Benutzerhandbuch.pdf)', '']
for i,page in enumerate(DATA['pages'],1):
    lines += [f'## {i}. {page["title"]}', '',page['role'],'']
    for b in page['blocks']:
        k=b['type']
        if k in ['p','sub','tip','step','check']:
            prefix={'sub':'### ','tip':'> ','step':str(b.get('n',''))+'. ','check':'- [ ] '}.get(k,'')
            lines.extend([prefix+md(b['text']),''])
        elif k=='image':lines.extend([f'![Ansicht mit Beispieldaten](handbuch/bilder/{b["name"]}.png)',''])
        elif k=='table':
            rows=b['rows'];lines += ['| '+' | '.join(rows[0])+' |','| '+' | '.join(['---']*len(rows[0]))+' |']+['| '+' | '.join(r)+' |' for r in rows[1:]]+['']
        elif k=='cover':lines += [f'[Portal öffnen]({DATA["portal"]})','']
lines += ['---','','Pflege: Inhalte in `docs/handbuch/inhalte.json`, Bildschirmbilder in `docs/handbuch/bilder/`. PDF und Textfassung mit `python3 scripts/create-handbook.py` neu erstellen. Änderungen am Handbuch veröffentlichen keine App-Version.','']
(ROOT/'docs/BENUTZERHANDBUCH.md').write_text('\n'.join(lines))
print(OUT)
