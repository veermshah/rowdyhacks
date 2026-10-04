"""Merge a downloaded OSM /api/0.6/map XML into the downtown map.
Usage: python scripts/import-campus.py path/to/campus.osm
The existing downtown features are preserved by OSM ID.
"""
import json, math, sys, xml.etree.ElementTree as ET
from pathlib import Path
root=ET.parse(sys.argv[1]).getroot()
output=Path(__file__).resolve().parents[1]/'public/data/downtown.json'
data=json.loads(output.read_text())
nodes={n.get('id'):(float(n.get('lat')),float(n.get('lon'))) for n in root.findall('node')}
scale=111320*math.cos(math.radians(29.422))
widths={'motorway':14,'trunk':14,'primary':12,'secondary':10,'tertiary':9,'residential':7,'service':5,'footway':2,'cycleway':2,'pedestrian':4}
known={key:{v['id'] for v in data[key]} for key in ['roads','buildings','water']}
for way in root.findall('way'):
    t={v.get('k'):v.get('v') for v in way.findall('tag')}
    refs=[n.get('ref') for n in way.findall('nd')]
    if any(n not in nodes for n in refs): continue
    points=[{'x':(nodes[n][1]+98.487)*scale,'z':-(nodes[n][0]-29.422)*110540} for n in refs]
    if len(points)<2: continue
    item={'id':int(way.get('id')),'points':points,'name':t.get('name')}
    if 'highway' in t:
        kind='roads'; hw=t['highway']
        if hw in ['steps','corridor','elevator']: continue
        item.update(type=hw,width=widths.get(hw,7),bridge=t.get('bridge')=='yes',tunnel=t.get('tunnel') in ['yes','culvert'],layer=int(t.get('layer',0)),lanes=None,oneway=t.get('oneway'))
    elif 'building' in t:
        kind='buildings'; levels=float(t.get('building:levels',4))
        item.update(type=t['building'],height=float(t.get('height',levels*3.3)),levels=levels,minHeight=float(t.get('min_height',0)))
    elif 'waterway' in t:
        kind='water';item.update(type=t['waterway'])
    else: continue
    if item['id'] not in known[kind]: data[kind].append(item);known[kind].add(item['id'])
data['bounds']['west']=-98.505
output.write_text(json.dumps(data,separators=(',',':')))
print({key:len(data[key]) for key in known})
