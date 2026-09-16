#!/usr/bin/env python3
"""Render mfp/src/*.txt into plain recipe pages + the catalog. Run from anywhere: python3 mfp/build.py

Source file format (mfp/src/<slug>.txt):
    Recipe Name
    servings: 4

    1 cup ingredient
    2 tbsp another
"""
import json, html, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SITE = "https://roblogic.org/mfp"

def parse(path):
    lines = [l.rstrip() for l in path.read_text(encoding="utf-8").splitlines()]
    name = lines[0].strip()
    servings = "1"
    ingredients = []
    for l in lines[1:]:
        if not l.strip():
            continue
        if l.lower().startswith("servings:"):
            servings = l.split(":", 1)[1].strip()
        else:
            ingredients.append(l.strip())
    return name, servings, ingredients

def page(slug, name, servings, ingredients):
    ld = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": name,
        "url": f"{SITE}/{slug}/",
        "recipeYield": f"{servings} servings",
        "recipeIngredient": ingredients,
    }
    items = "\n".join(f"<li>{html.escape(i)}</li>" for i in ingredients)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(name)}</title>
<script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False, indent=1)}
</script>
</head>
<body>
<h1>{html.escape(name)}</h1>
<p>Servings: {html.escape(servings)}</p>
<ul>
{items}
</ul>
<p><a href="/mfp/">All recipes</a></p>
</body>
</html>
"""

def main():
    entries = []
    for src in sorted(ROOT.glob("src/*.txt")):
        slug = src.stem
        name, servings, ingredients = parse(src)
        out = ROOT / slug / "index.html"
        out.parent.mkdir(exist_ok=True)
        out.write_text(page(slug, name, servings, ingredients), encoding="utf-8")
        entries.append((name, slug))
    links = "\n".join(f'<li><a href="/mfp/{slug}/">{html.escape(name)}</a></li>' for name, slug in sorted(entries))
    (ROOT / "index.html").write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MFP Recipes</title>
</head>
<body>
<h1>MFP Recipes</h1>
<ul>
{links}
</ul>
</body>
</html>
""", encoding="utf-8")
    print(f"built {len(entries)} recipes + catalog")

if __name__ == "__main__":
    main()
