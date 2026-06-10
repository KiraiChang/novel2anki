import json, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

data_dir = os.environ.get('WORD_CACHE_PATH', 'src/data')
with open(os.path.join(data_dir, 'phrase-list.json'), encoding='utf-8') as f:
    db = json.load(f)

checks = [
    'it is important to', 'it is important to note that',
    'for example', 'so for example',
    'in order to', 'the fact that',
    'as a whole', 'as well as',
    'in addition to', 'take into account',
    'look forward to', 'make sense',
    'based on', 'in particular',
    'such as', 'at the same time',
]
print('=== Specific checks ===')
for k in checks:
    v = db.get(k, 'NOT FOUND')
    print(f'  {k!r}: {v}')

print()
print('=== Sample A1 entries ===')
a1 = [(k,v) for k,v in db.items() if v.get('opl_level')=='A1']
for k,v in a1[:20]:
    print(f'  {k!r}: {v}')
print(f'  ... total A1: {len(a1)}')

print()
print('=== Sample OPAL both (spoken+written) ===')
both = [(k,v) for k,v in db.items() if v.get('opal_spoken') and v.get('opal_written')][:20]
for k,v in both:
    print(f'  {k!r}: {v}')

print()
print('=== Possible noise (> 8 words) ===')
long_ones = [(k,v) for k,v in db.items() if len(k.split()) > 8]
for k,v in long_ones[:20]:
    print(f'  {k!r}: {v}')

print()
print(f'Total phrases: {len(db)}')
print(f'Longest: {max(db.keys(), key=lambda x: len(x.split()))}')
