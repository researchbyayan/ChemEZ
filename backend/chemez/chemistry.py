"""All displayed chemical geometry is generated locally, never supplied as model HTML."""
import re
import sys
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree as ET
from rdkit import Chem
from rdkit.Chem import rdDepictor, rdMolDescriptors, rdPartialCharges
from rdkit.Chem.Draw import rdMolDraw2D
from .models import Molecule, Arrow
from .common_names import common_smiles, formula_smiles

SVG = 'http://www.w3.org/2000/svg'

def svg_bounds(root):
    """[x0, y0, x1, y1] of an SVG root, from its viewBox or else its pixel size."""
    if root.get('viewBox'):
        x, y, w, h = (float(v) for v in root.get('viewBox').split())
        return [x, y, x+w, y+h]
    return [0., 0., float(root.get('width','0').rstrip('px')), float(root.get('height','0').rstrip('px'))]

def fit_svg(root, bounds):
    """Set an SVG root's viewBox and pixel size to the given [x0, y0, x1, y1]."""
    root.set('viewBox', f'{bounds[0]} {bounds[1]} {bounds[2]-bounds[0]} {bounds[3]-bounds[1]}')
    root.set('width', f'{bounds[2]-bounds[0]}px'); root.set('height', f'{bounds[3]-bounds[1]}px')

def same_compound(a, b):
    """Same structure, ignoring stereochemistry (Mol objects)."""
    return Chem.MolToSmiles(a, isomericSmiles=False) == Chem.MolToSmiles(b, isomericSmiles=False)
ET.register_namespace('', SVG)

# Exact structure matches only; formulas cannot determine connectivity or names.
_NAMES = {Chem.MolToSmiles(Chem.MolFromSmiles(smiles),isomericSmiles=True):name for smiles,name in [
    ('c1ccccc1','benzene'),('Oc1ccccc1','phenol'),('O=S(=O)(O)c1ccccc1','benzenesulfonic acid'),
    ('[Na+].O=S(=O)([O-])c1ccccc1','sodium benzenesulfonate'),('[Na+].[O-]c1ccccc1','sodium phenolate'),
    ('CCO','ethanol'),('CC=O','ethanal'),('CC(=O)O','ethanoic acid'),('CCOC(C)=O','ethyl ethanoate'),
    ('O','water'),('O=C=O','carbon dioxide'),('N','ammonia'),('C','methane'),('[Na+].[OH-]','sodium hydroxide')
]}

def structure_name(smiles, proposed=''):
    mol=Chem.MolFromSmiles(smiles)
    known=_NAMES.get(Chem.MolToSmiles(mol,isomericSmiles=True)) if mol else None
    return (known,'local') if known else (proposed.strip(),'model' if proposed.strip() else 'unavailable')

def enrich_names(block):
    result=dict(block)
    if block.get('type')=='molecule' or ('smiles' in block and 'svg' in block and 'steps' not in block):
        result['iupac_name'],result['name_source']=structure_name(block['smiles'],block.get('iupac_name',''))
        if not result.get('formula'):
            mol=Chem.MolFromSmiles(block['smiles'])
            if mol:result['formula']=rdMolDescriptors.CalcMolFormula(mol)
    for side in ('reactants','products'):
        if side in block:result[side]=[enrich_names(item) for item in block[side]]
    if 'steps' in block:result['steps']=[enrich_names(item) for item in block['steps']]
    return result

def molecule(smiles: str, formula: str | None = None, preserve_hydrogens=False):
    parameters=Chem.SmilesParserParams()
    parameters.removeHs=not preserve_hydrogens
    mol = Chem.MolFromSmiles(smiles,parameters)
    if mol is None:
        mol = bracket_charges(smiles,preserve_hydrogens)
    if mol is None and (written:=formula_smiles(smiles)):
        mol = Chem.MolFromSmiles(written,parameters)
    if mol is None or not mol.GetNumAtoms():
        raise ValueError(f'"{smiles[:80]}" is not valid SMILES. Write a SMILES string (e.g. ClC(Cl)=O for phosgene), not a molecular formula or name.')
    if mol.GetNumAtoms() > 250:
        raise ValueError('Diagrams are limited to 250 atoms per structure.')
    actual = rdMolDescriptors.CalcMolFormula(mol)
    if formula and normalize_formula(actual) != normalize_formula(formula):
        raise ValueError(f'Formula mismatch: the structure has formula {actual}, not {formula}.')
    return mol, actual

def bracket_charges(smiles, preserve_hydrogens=False):
    """Charges written outside brackets ("C+", or "O-" at a branch end) are a common slip ("-" elsewhere is a bond): c1ccc(C+)cc1 means
    the benzyl cation [CH2+]c1ccccc1. Bracket them and let RDKit add the hydrogens."""
    parts = re.split(r'(\[[^\]]*\])', smiles)
    fixed = ''.join(part if part.startswith('[') else re.sub(r'(Cl|Br|[BCNOSPFIcnosp])(\+|-(?=[).]|$))', r'[\1\2:999]', part) for part in parts)
    if fixed == smiles:
        return None
    mol = Chem.MolFromSmiles(fixed, sanitize=False)
    if mol is None:
        return None
    for atom in mol.GetAtoms():
        if atom.GetAtomMapNum() == 999:
            atom.SetAtomMapNum(0)
            atom.SetNoImplicit(False)
    try:
        Chem.SanitizeMol(mol)
    except (ValueError, RuntimeError):
        return None
    return mol if preserve_hydrogens else Chem.RemoveHs(mol)

def normalize_formula(value):
    value = value.translate(str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')).replace(' ', '')
    # Compare atom inventories, allowing ordinary Hill/non-Hill ordering.
    tokens = re.findall(r'([A-Z][a-z]?)(\d*)', value)
    charge = re.sub(r'([A-Z][a-z]?)(\d*)', '', value)
    counts = {}
    for symbol, count in tokens:
        counts[symbol] = counts.get(symbol, 0) + int(count or 1)
    return sorted(counts.items()), charge

def encode(smiles):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor')) if str(Path(__file__).resolve().parents[1] / 'vendor') not in sys.path else None
        from seq_encode.smiles import smiles_coder
        coder = smiles_coder()
        coder.fit([smiles], max_length=max(150, len(smiles)))
        matrix = coder.transform([smiles])[0]
        return {'available': True, 'shape': list(matrix.shape), 'alphabet': coder.char_to_int, 'one_hot_indices': matrix.argmax(axis=1).tolist()}
    except Exception:
        return {'available': False, 'warning': 'Sequence encoding is unavailable; the validated drawing is still usable.'}

def spread_fragments(mol, gap=1.6):
    """Lay dot-disconnected species out left to right (SMILES order) instead of stacked."""
    fragments = Chem.GetMolFrags(mol)
    if len(fragments) < 2:
        return
    conformer, x = mol.GetConformer(), 0.0
    for fragment in fragments:
        points = [conformer.GetAtomPosition(i) for i in fragment]
        left, right = min(p.x for p in points), max(p.x for p in points)
        middle = (min(p.y for p in points)+max(p.y for p in points))/2
        for i, p in zip(fragment, points):
            conformer.SetAtomPosition(i, (p.x-left+x, p.y-middle, 0.0))
        x += right-left+gap

# Drawn before the app's dark-mode inversion, so this dark green displays as a light green.
HIGHLIGHT = (0.22, 0.5, 0.33)
# Element colours chosen so that, after the app's invert + hue-rotate(180°) dark-mode filter,
# heteroatoms stay bright (sulfur, nitrogen and chlorine were nearly invisible), while the
# untouched SVG/PNG export stays readable on white.
ATOM_PALETTE = {8: (0.87, 0.32, 0.32), 7: (0.2, 0.33, 0.65), 16: (0.3, 0.17, 0.0), 17: (0.0, 0.37, 0.0),
                35: (0.64, 0.34, 0.19), 53: (0.52, 0.29, 0.74), 15: (0.6, 0.25, 0.0), 9: (0.02, 0.27, 0.0),
                5: (0.47, 0.17, 0.17), 14: (0.33, 0.23, 0.08)}

def draw(mol, arrows: list[Arrow] | None = None, highlight: list[int] | None = None, stereo: bool = False,
         keep_coords: bool = False, circles: list[tuple[int, ...]] | None = None, lone_pairs: bool = False, ring_flow: bool = False):
    # keep_coords: the caller set a shared layout (resonance contributors stay aligned).
    if not (keep_coords and mol.GetNumConformers()):
        rdDepictor.Compute2DCoords(mol)
        spread_fragments(mol, gap=2.4 if arrows else 1.6)
    # A fixed bond length and a canvas sized to the molecule keep every structure at one
    # scale, so small species are not blown up and large ones are not shrunk.
    drawer = rdMolDraw2D.MolDraw2DSVG(-1, -1)
    options = drawer.drawOptions()
    options.padding = 0.15
    options.clearBackground = False
    options.updateAtomPalette(ATOM_PALETTE)
    # On a flexible canvas the scaling factor sets the bond length (about 1.36 px per unit).
    # Mechanism steps are drawn larger: they carry arrows and several fragments.
    options.scalingFactor = 50 if arrows is not None else 28
    options.fixedFontSize = 20 if arrows is not None else 15
    options.explicitMethyl = arrows is not None
    if stereo:
        options.addStereoAnnotation = True
    if highlight:
        atoms = set(highlight)
        bonds = [b.GetIdx() for b in mol.GetBonds() if b.GetBeginAtomIdx() in atoms and b.GetEndAtomIdx() in atoms]
        drawer.DrawMolecule(mol, highlightAtoms=sorted(atoms), highlightBonds=bonds,
                            highlightAtomColors={i: HIGHLIGHT for i in atoms}, highlightBondColors={i: HIGHLIGHT for i in bonds})
    else:
        drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    root = ET.fromstring(drawer.GetDrawingText())
    root.set('role', 'img')
    for ring in circles or []:
        # Delocalized (hybrid) ring: a circle inside the ring, as in textbook notation.
        points = [drawer.GetDrawCoords(i) for i in ring]
        cx, cy = sum(p.x for p in points)/len(points), sum(p.y for p in points)/len(points)
        radius = 0.6*sum(((p.x-cx)**2+(p.y-cy)**2)**0.5 for p in points)/len(points)
        ET.SubElement(root, f'{{{SVG}}}circle', {'cx':f'{cx:.2f}','cy':f'{cy:.2f}','r':f'{radius:.2f}','fill':'none','stroke':'#000000','stroke-width':'2'})
    if lone_pairs:
        sites={}
        fit_svg(root, add_lone_pairs(root,drawer,mol,svg_bounds(root),sites))
    if arrows:
        # Arrow geometry follows the drawn bond length; the canvas grows to fit the curves.
        bonds = sorted(((drawer.GetDrawCoords(b.GetBeginAtomIdx())-drawer.GetDrawCoords(b.GetEndAtomIdx())).Length() for b in mol.GetBonds()))
        unit = bonds[len(bonds)//2] if bonds else 25.0
        bounds = svg_bounds(root)
        drawn = [drawer.GetDrawCoords(i) for i in range(mol.GetNumAtoms())]
        centre = (sum(p.x for p in drawn)/len(drawn), sum(p.y for p in drawn)/len(drawn))
        sites = sites if lone_pairs else {}
        for index, arrow in enumerate(arrows):
            for anchor in (arrow.tail, arrow.head):
                if any(i < 0 or i >= mol.GetNumAtoms() for i in anchor):
                    raise ValueError('Mechanism arrow refers to an atom that is not present.')
                if anchor is arrow.tail and len(anchor) == 2 and mol.GetBondBetweenAtoms(*anchor) is None:
                    raise ValueError('Mechanism arrow bond anchor does not identify a bond.')
            def point(anchor):
                coords = [drawer.GetDrawCoords(i) for i in anchor]
                return sum(p.x for p in coords)/len(coords), sum(p.y for p in coords)/len(coords)
            x1,y1 = point(arrow.tail)
            x2,y2 = point(arrow.head)
            if len(arrow.tail)==1 and sites.get(arrow.tail[0]):
                # A lone pair is the source: start at the dot pair facing the target.
                # The pair on the side facing the target, so the arrow never crosses the label.
                ax,ay=point(arrow.tail)
                x1,y1=max(sites[arrow.tail[0]],key=lambda p:((p[0]-ax)*(x2-ax)+(p[1]-ay)*(y2-ay))/((((p[0]-ax)**2+(p[1]-ay)**2)**.5 or 1)*((((x2-ax)**2+(y2-ay)**2)**.5) or 1))-.01*(p[1]-ay)/unit)  # ties: the upper pair
            dx,dy = x2-x1,y2-y1
            length = (dx*dx+dy*dy)**0.5
            if length < 5:
                raise ValueError('Mechanism arrow anchors must be distinct.')
            # Bow the curve away from the molecule, as in textbooks; short arrows (a bond
            # onto its own atom) still get a visible arc.
            bow = max(0.6*unit, 0.45*length)
            mx,my = (x1+x2)/2,(y1+y2)/2
            side_a=(mx-dy/length-centre[0])**2+(my+dx/length-centre[1])**2
            side_b=(mx+dy/length-centre[0])**2+(my-dx/length-centre[1])**2
            outward = 1 if side_a >= side_b else -1
            if abs(side_a-side_b)<.05:
                # Symmetric (Cl–Cl): bow upwards, so paired fishhooks sit on one side.
                outward = 1 if dx/length < 0 else -1
            cx,cy = mx-dy/length*bow*outward,my+dx/length*bow*outward
            if ring_flow and len(arrow.tail)==len(arrow.head)==2:
                # Kekulé π flow stays inside the ring instead of looping around
                # its vertices. Both anchors remain the actual bond midpoints.
                x1,y1=point(arrow.tail);x2,y2=point(arrow.head)
                for_tail=((centre[0]-x1)**2+(centre[1]-y1)**2)**.5
                for_head=((centre[0]-x2)**2+(centre[1]-y2)**2)**.5
                if for_tail:
                    x1+=(centre[0]-x1)/for_tail*.12*unit;y1+=(centre[1]-y1)/for_tail*.12*unit
                if for_head:
                    x2+=(centre[0]-x2)/for_head*.12*unit;y2+=(centre[1]-y2)/for_head*.12*unit
                mx,my=(x1+x2)/2,(y1+y2)/2
                cx,cy=mx*.45+centre[0]*.55,my*.45+centre[1]*.55
            def clear(x,y,anchor,gap):
                # Pull an atom end back along the curve so it stops outside the label.
                ax,ay=point(anchor);vx,vy=cx-ax,cy-ay;d=(vx*vx+vy*vy)**.5 or 1
                return ax+vx/d*gap,ay+vy/d*gap
            if len(arrow.head)==1 and len(arrow.tail)==2:
                # Bond onto its own atom (heterolysis, π to an atom): land on the atom's
                # outer shoulder, on the side the curve bows to.
                ax,ay=point(arrow.head);bx,by=point(arrow.tail)
                ux,uy=ax-bx,ay-by;d=(ux*ux+uy*uy)**.5 or 1;ux,uy=ux/d,uy/d
                px,py=cx-mx,cy-my;e=(px*px+py*py)**.5 or 1;px,py=px/e,py/e
                vx,vy=px+.6*ux,py+.6*uy;f=(vx*vx+vy*vy)**.5
                x2,y2=ax+vx/f*.32*unit,ay+vy/f*.32*unit
                cx,cy=(x1+x2)/2+px*.45*unit,(y1+y2)/2+py*.45*unit
            elif len(arrow.head)==1:
                x2,y2=clear(x2,y2,arrow.head,.3*unit)
            elif not ring_flow:
                # Bond or new-bond targets: stop just short of the midpoint.
                vx,vy=cx-x2,cy-y2;d=(vx*vx+vy*vy)**.5 or 1
                x2,y2=x2+vx/d*.12*unit,y2+vy/d*.12*unit
            if len(arrow.tail)==1 and not sites.get(arrow.tail[0]):
                x1,y1=clear(x1,y1,arrow.tail,.3*unit)
            for x,y in ((x1,y1),(cx,cy),(x2,y2)):
                bounds = [min(bounds[0],x-10),min(bounds[1],y-10),max(bounds[2],x+10),max(bounds[3],y+10)]
            # Drawn arrowhead (ChemDraw/ACS style, after ReShiki's notched head): it follows
            # the curve's tangent at the tip. A full head for an electron pair; a fishhook is
            # one barb on the outside of the curve for a single electron.
            tx,ty=x2-cx,y2-cy;t=(tx*tx+ty*ty)**.5 or 1;tx,ty=tx/t,ty/t
            head,half=.2*unit,.08*unit
            nx,ny=-ty,tx
            if (cx-mx)*nx+(cy-my)*ny>0:nx,ny=-nx,-ny  # nx,ny now points away from the bow
            bx,by=x2-tx*head,y2-ty*head
            notch=(x2-tx*head*.875,y2-ty*head*.875)
            outer=(bx+nx*half,by+ny*half);inner=(bx-nx*half,by-ny*half)
            points=[(x2,y2),outer,notch,inner] if arrow.electrons==2 else [(x2,y2),outer,notch]
            # The shaft stops inside the head so its end never shows past the tip.
            sx,sy=(x2-tx*head*.6,y2-ty*head*.6) if arrow.electrons==2 else (x2,y2)
            ET.SubElement(root, f'{{{SVG}}}path', {'d':f'M {x1:.2f} {y1:.2f} Q {cx:.2f} {cy:.2f} {sx:.2f} {sy:.2f}', 'fill':'none','stroke':'#a139ce','stroke-width':'2','stroke-linecap':'round','data-electrons':str(arrow.electrons),'class':'electron-flow','data-layout':'ring' if ring_flow else 'standard'})
            ET.SubElement(root, f'{{{SVG}}}path', {'d':'M '+' L '.join(f'{x:.2f} {y:.2f}' for x,y in points)+' Z','fill':'#a139ce','stroke':'#a139ce','stroke-width':'.8','stroke-linejoin':'round','class':'electron-flow-head','data-electrons':str(arrow.electrons)})
            if arrow.electrons==2 and not (len(arrow.tail)==1 and sites.get(arrow.tail[0])):
                for delta in (-2.4,2.4):
                    ET.SubElement(root,f'{{{SVG}}}circle',{'cx':f'{x1-dy/length*delta:.2f}','cy':f'{y1+dx/length*delta:.2f}','r':'1.6','fill':'#a139ce','class':'electron-pair-dot'})
        width, height = bounds[2]-bounds[0], bounds[3]-bounds[1]
        root.set('viewBox', f'{bounds[0]:.1f} {bounds[1]:.1f} {width:.1f} {height:.1f}')
        root.set('width', f'{width:.0f}px'); root.set('height', f'{height:.0f}px')
    return ET.tostring(root, encoding='unicode')

def depiction_molecule(smiles, validated):
    # Keep explicit Kekulé bond positions for resonance contributors. Chemical identity
    # and formula still come from the fully sanitized molecule above.
    if not any(atom.GetIsAromatic() for atom in validated.GetAtoms()):
        return validated
    display = Chem.MolFromSmiles(smiles, sanitize=False)
    if display is None or any(bond.GetIsAromatic() for bond in display.GetBonds()):
        return validated
    try:
        Chem.SanitizeMol(display, sanitizeOps=Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_SETAROMATICITY)
        Chem.AssignStereochemistry(display, cleanIt=True, force=True)
        return display
    except (ValueError, RuntimeError):
        return validated

def atom_charges(smiles):
    """Gasteiger partial charges in SMILES atom order, for the interactive SMILES view."""
    mol = Chem.MolFromSmiles(smiles)
    try:
        rdPartialCharges.ComputeGasteigerCharges(mol)
        values = [atom.GetDoubleProp('_GasteigerCharge') for atom in mol.GetAtoms()]
    except (ValueError, RuntimeError, KeyError):
        return []
    return [round(v, 3) if v == v and abs(v) != float('inf') else 0.0 for v in values]

# Unambiguous name cues and what the structure must then contain. Catches a model naming
# one compound while supplying SMILES for another (e.g. "1-phenylethanone" drawn as acetone).
_NAME_CUES = [
    (r'phenyl|benz|tolu|anilin|phenol|anisol|xylen|styren|naphth', 'aromatic ring', lambda m: any(a.GetIsAromatic() for a in m.GetAtoms())),
    (r'cyclo', 'ring', lambda m: m.GetRingInfo().NumRings() > 0),
    (r'chlor', 'chlorine', lambda m: any(a.GetSymbol() == 'Cl' for a in m.GetAtoms())),
    (r'brom', 'bromine', lambda m: any(a.GetSymbol() == 'Br' for a in m.GetAtoms())),
    (r'iod', 'iodine', lambda m: any(a.GetSymbol() == 'I' for a in m.GetAtoms())),
    (r'fluor', 'fluorine', lambda m: any(a.GetSymbol() == 'F' for a in m.GetAtoms())),
    (r'amin|amid|nitr|azo|pyridin|anilin', 'nitrogen', lambda m: any(a.GetSymbol() == 'N' for a in m.GetAtoms())),
    (r'ol\b|al\b|one\b|oic|oate|ether|oxy|phenol|anisol|aldehyde|ketone', 'oxygen', lambda m: any(a.GetSymbol() == 'O' for a in m.GetAtoms())),
]

def check_name(name, mol):
    lowered = name.lower()
    for pattern, needs, present in _NAME_CUES:
        if re.search(pattern, lowered) and not present(mol):
            raise ValueError(f'The name "{name[:80]}" does not match the supplied SMILES, which has no {needs} (formula {rdMolDescriptors.CalcMolFormula(mol)}). Correct the SMILES or the name.')

def skeleton_key(mol):
    """Atoms and connectivity only: bond orders, charges and aromaticity ignored."""
    rw = Chem.RWMol(mol)
    for atom in rw.GetAtoms():
        atom.SetFormalCharge(0); atom.SetIsAromatic(False); atom.SetNumRadicalElectrons(0)
        atom.SetNoImplicit(True); atom.SetNumExplicitHs(0)
    for bond in rw.GetBonds():
        bond.SetBondType(Chem.BondType.SINGLE); bond.SetIsAromatic(False)
    rw.UpdatePropertyCache(strict=False)
    return Chem.MolToSmiles(rw)

def resonance_form(a, b):
    """Same atoms, connectivity, hydrogens and net charge; only electrons differ."""
    return skeleton_key(a) == skeleton_key(b) and rdMolDescriptors.CalcMolFormula(a) == rdMolDescriptors.CalcMolFormula(b)

def resolve_common(spec: Molecule):
    """Draw the verified structure when the model names a common compound but writes a different SMILES."""
    local = common_smiles(spec.iupac_name, spec.label)
    if not local:
        return spec
    named, labelled=common_smiles(spec.iupac_name),common_smiles(spec.label)
    if named and labelled and not same_compound(Chem.MolFromSmiles(named),Chem.MolFromSmiles(labelled)):
        raise ValueError('The IUPAC name and label identify different compounds. Correct the name and structure before drawing this molecule.')
    given = Chem.MolFromSmiles(spec.smiles)
    reference = Chem.MolFromSmiles(local)
    same_graph = given is not None and same_compound(given,reference)
    explicit_stereo = bool(re.search(r'\([\d,RSZErsze-]+\)|\b[LD]-',spec.iupac_name+' '+spec.label))
    if explicit_stereo and spec.iupac_name and not named:
        if same_graph:
            return spec.model_copy(update={'formula':None})
        raise ValueError('The named stereochemistry could not be confirmed against the proposed structure. Correct the stereochemical name and SMILES.')
    if given is not None and not same_graph and resonance_form(given, reference):
        # A resonance contributor (e.g. charge-separated benzene) of the named compound:
        # keep the drawn electron arrangement instead of replacing it with the parent structure.
        return spec.model_copy(update={'formula':None})
    reference_has_stereo=Chem.MolToSmiles(reference)!=Chem.MolToSmiles(reference,isomericSmiles=False)
    if same_graph and (not explicit_stereo or not reference_has_stereo or Chem.MolToSmiles(given)==Chem.MolToSmiles(reference)):
        # A generic name must not replace user/model-specified stereochemistry with
        # the one enantiomer that happens to occur in a reference table.
        return spec.model_copy(update={'formula':None})
    if not explicit_stereo:
        Chem.RemoveStereochemistry(reference)
        local=Chem.MolToSmiles(reference)
    # Once the named compound has a verified structure, calculate its formula locally.
    return spec.model_copy(update={'smiles': local, 'formula': None})

def structure_check(mol, declared=''):
    """Checks after Chemaxon's documented Structure Checker list, for one drawn molecule:
    placeholder atoms, unexplained isotopes or radicals, and alkali metals bonded covalently."""
    if any(a.GetAtomicNum()==0 for a in mol.GetAtoms()):
        raise ValueError('The structure contains a placeholder atom (*). Draw the actual atoms.')
    if any(a.GetIsotope() for a in mol.GetAtoms()) and not re.search(r'isotop|deuter|tritium|label|\b\d+[A-Z]|\[\d|-d\d?\b',declared,re.I):
        raise ValueError('The structure specifies an isotope that its name does not mention. Remove the isotope label, or name the labelled compound.')
    if any(a.GetNumRadicalElectrons() for a in mol.GetAtoms()) and not re.search(r'radical|carbene|nitrene|oxygen|\bO2\b|dioxygen|nitric oxide|NO\b|nitrogen dioxide|triplet|biradical|diradical|\u2022|·',declared,re.I):
        raise ValueError('The structure has an unpaired electron, but it is not named as a radical. Add the missing hydrogens or bonds, or name the radical.')
    for bond in mol.GetBonds():
        ends={bond.GetBeginAtom().GetSymbol(),bond.GetEndAtom().GetSymbol()}
        if ends&{'Li','Na','K','Rb','Cs'} and ends&{'O','N','S','F','Cl','Br','I'}:
            raise ValueError('Alkali-metal salts are ionic: write them as separate ions, for example CC(=O)[O-].[Na+], not CC(=O)O[Na].')

def molecule_result(spec: Molecule):
    original=spec
    spec = resolve_common(spec)
    mol, formula = molecule(spec.smiles, spec.formula)
    declared=spec.iupac_name+' '+spec.label
    structure_check(mol, declared)
    if re.search(r'\((?:\d*[RSrs],?)+\)',declared) and not any(atom.GetChiralTag()!=Chem.ChiralType.CHI_UNSPECIFIED for atom in mol.GetAtoms()):
        raise ValueError('The R/S name specifies stereochemistry, but the structure does not. Supply explicit chiral SMILES before drawing this enantiomer.')
    if re.search(r'\([EZ]\)|\b(?:cis|trans)-',declared) and not any(atom.GetChiralTag()!=Chem.ChiralType.CHI_UNSPECIFIED for atom in mol.GetAtoms()) and not any(bond.GetStereo() not in (Chem.BondStereo.STEREONONE,Chem.BondStereo.STEREOANY) for bond in mol.GetBonds()):
        raise ValueError('The name specifies cis/trans or E/Z stereochemistry, but the structure does not. Supply stereochemical SMILES.')
    canonical = Chem.MolToSmiles(mol, isomericSmiles=True)
    name,source=structure_name(canonical,spec.iupac_name)
    if source == 'model':
        check_name(name, mol)
    corrections=[]
    if original.smiles!=spec.smiles:
        corrections.append('Structure resolved from the local compound reference.')
    if original.formula and normalize_formula(original.formula)!=normalize_formula(formula):
        corrections.append(f'Molecular formula corrected from {original.formula} to {formula} using the verified structure.')
    return {'smiles':canonical,'label':spec.label,'formula':formula,'iupac_name':name,'name_source':source,'svg':draw(depiction_molecule(spec.smiles,mol)),'encoding':encode(canonical),'atom_charges':atom_charges(canonical),**({'validation_notes':corrections} if corrections else {})}

_SUB = str.maketrans('0123456789+-', '₀₁₂₃₄₅₆₇₈₉₊₋')
_SUP = str.maketrans('0123456789+-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻')

def plain_chem(text):
    """Export text without LaTeX: $\\text{AlCl}_3$ -> AlCl₃, CH3OH -> CH₃OH."""
    text = re.sub(r'\\(?:text|mathrm|ce|mathbf|textbf)\{([^{}]*)\}', r'\1', text or '')
    text = re.sub(r'_\{?([0-9+-]+)\}?', lambda m: m.group(1).translate(_SUB), text)
    text = re.sub(r'\^\{?([0-9+-]+)\}?', lambda m: m.group(1).translate(_SUP), text)
    text = text.replace('\\rightarrow', '→').replace('\\to', '→').replace('\\Delta', 'Δ').replace('\\,', ' ')
    text = re.sub(r'[$\\{}]', '', text)
    return re.sub(r'([A-Z][a-z]?|\))(\d+)', lambda m: m.group(1)+m.group(2).translate(_SUB), text)

def formula_text(formula):
    match = re.match(r'^(.*?)([+-]\d*)$', formula or '')
    body, charge = (match.group(1), match.group(2)) if match else (formula or '', '')
    return re.sub(r'(\d+)', lambda m: m.group(1).translate(_SUB), body) + (charge[1:]+charge[0]).translate(_SUP) if charge else re.sub(r'(\d+)', lambda m: m.group(1).translate(_SUB), body)

def display_name(name):
    """Capitalise after locants and italic prefixes, as the app does: tert-Butanol, 2-Acetyloxybenzoic acid."""
    return re.sub(r"^((?:[\d\s,'′]+-|\([^)]*\)-|[A-Z\d,'′]+-|(?:n|sec|tert|cis|trans|o|m|p|endo|exo)-)*)([a-z])", lambda m: m.group(1)+m.group(2).upper(), name or '')

def reaction_result(block):
    left = [molecule_result(spec) for spec in block.reactants]
    right = [molecule_result(spec) for spec in block.products]
    carbons=lambda items:sum(sum(a.GetAtomicNum()==6 for a in Chem.MolFromSmiles(item['smiles']).GetAtoms()) for item in items)
    carbon_free=r'(?:H2SO4|HCl|HBr|NaOH|KOH|H2O|FeCl3|FeBr3|acid(?: catalyst)?|base|heat|dilute base|strong base)'
    agents=[part.strip() for part in re.split(r',|;|\bthen\b',block.reagents,flags=re.I) if part.strip()]
    if carbons(right)>carbons(left) and agents and all(re.fullmatch(carbon_free,part,re.I) for part in agents):
        raise ValueError('The reaction creates carbon atoms without a carbon-bearing reactant or reagent. Include the missing organic reactant before drawing the scheme.')
    # A Lewis-acid catalyst label is not a stoichiometric halogen source.
    # Restrict this check to unambiguous catalyst-only schemes; do not claim
    # complete atom balancing when the schema has no stoichiometric coefficients.
    atom_count=lambda items,symbol:sum(sum(a.GetSymbol()==symbol for a in Chem.MolFromSmiles(item['smiles']).GetAtoms()) for item in items)
    for symbol,catalysts in [('Br',r'(?:FeBr3|AlBr3)'),('Cl',r'(?:FeCl3|AlCl3)')]:
        if agents and atom_count(right,symbol)>atom_count(left,symbol) and all(re.fullmatch(catalysts+r'|heat|light|UV',part,re.I) for part in agents):
            raise ValueError(f'The drawn scheme adds {symbol} but lists only a catalyst or energy input. Include the actual halogenating reagent, not just its catalyst.')
    mark_changes(left, right)
    # Compose trusted RDKit geometry in a single downloadable SVG, keeping each
    # structure at its own drawn size so all participants share one scale.
    import textwrap
    scale, gap, arrow = 1.0, 40, 200
    def size(item):
        root = ET.fromstring(item['svg'])
        return float(root.get('width','600').rstrip('px'))*scale, float(root.get('height','340').rstrip('px'))*scale
    sizes = [size(item) for item in left+right]
    cells = [max(w, 150) for w,_ in sizes]
    tallest = max(h for _,h in sizes)
    mid = 30 + tallest/2
    name_lines=[textwrap.wrap(display_name(item['iupac_name'] or item['label']) or formula_text(item['formula']),24) for item in left+right]
    width = sum(cells) + gap*(len(cells)-2) + arrow
    height = tallest + 70 + 18*max(len(lines) for lines in name_lines)
    root = ET.Element(f'{{{SVG}}}svg', {'viewBox':f'0 0 {width:.0f} {height:.0f}','width':f'{width:.0f}','height':f'{height:.0f}','role':'img'})
    def add_text(x,y,text,size='16'):
        node = ET.SubElement(root, f'{{{SVG}}}text', {'x':f'{x:.1f}','y':f'{y:.1f}','text-anchor':'middle','font-family':'sans-serif','font-size':size,'fill':'#172d35'})
        node.text = text
    x, position = 0, 0
    for side in (left,right):
        for index,item in enumerate(side):
            (w,h), cell, lines = sizes[position], cells[position], name_lines[position]
            nested = ET.fromstring(item['svg'])
            nested.set('x',f'{x+(cell-w)/2:.1f}'); nested.set('y',f'{mid-h/2:.1f}'); nested.set('width',f'{w:.1f}'); nested.set('height',f'{h:.1f}')
            root.append(nested)
            for line,text in enumerate(lines):add_text(x+cell/2,tallest+55+line*18,text,'14')
            add_text(x+cell/2,tallest+55+len(lines)*18,formula_text(item['formula']),'12')
            x += cell
            position += 1
            if index < len(side)-1:
                add_text(x+gap/2,mid+8,'+', '24')
                x += gap
        if side is left:
            ET.SubElement(root,f'{{{SVG}}}path',{'d':f'M {x+15:.1f} {mid:.1f} H {x+arrow-15:.1f} m -12 -7 l 12 7 l -12 7','fill':'none','stroke':'#172d35','stroke-width':'2'})
            # Reagents/conditions wrap instead of silently clipping long labels.
            reagents = textwrap.wrap(plain_chem(block.reagents), 26)
            for line,text in enumerate(reagents):
                add_text(x+arrow/2,mid-12-(len(reagents)-1-line)*18,text,'13')
            for line,text in enumerate(textwrap.wrap(plain_chem(block.conditions), 26)):
                add_text(x+arrow/2,mid+24+line*18,text,'13')
            x += arrow
    return {'reactants':left,'products':right,'svg':ET.tostring(root,encoding='unicode')}

def resonance_step(display, following, arrows):
    """Check that electron-pair arrows turn one resonance contributor into the next."""
    predicted={tuple(sorted((b.GetBeginAtomIdx(),b.GetEndAtomIdx()))):b.GetBondTypeAsDouble() for b in display.GetBonds()}
    charges=[a.GetFormalCharge() for a in display.GetAtoms()]
    if any(a.electrons!=2 for a in arrows):
        raise ValueError('Closed-shell resonance uses electron-pair arrows, not single-electron fishhooks.')
    for arrow in arrows:
        for anchor,sign in [(arrow.tail,1),(arrow.head,-1)]:
            if any(i<0 or i>=len(charges) for i in anchor):
                raise ValueError('Electron-flow anchor is outside the structure.')
            if len(anchor)==2:
                pair=tuple(sorted(anchor))
                if pair not in predicted:raise ValueError('Electron-flow bond anchor is not a bond.')
                predicted[pair]-=sign
                for atom in anchor:charges[atom]+=sign
            else:charges[anchor[0]]+=2*sign
    target={tuple(sorted((b.GetBeginAtomIdx(),b.GetEndAtomIdx()))):b.GetBondTypeAsDouble() for b in following.GetBonds()}
    if predicted!=target or charges!=[a.GetFormalCharge() for a in following.GetAtoms()]:
        raise ValueError('The proposed electron-pair arrows do not produce the next contributor’s bonds and formal charges.')

def infer_resonance_arrows(display, following, most=3):
    """Smallest set (up to `most`) of electron-pair arrows linking two contributors, or None."""
    from itertools import combinations
    bonds=lambda mol:{tuple(sorted((b.GetBeginAtomIdx(),b.GetEndAtomIdx()))):b.GetBondTypeAsDouble() for b in mol.GetBonds()}
    before,after=bonds(display),bonds(following)
    lost=[pair for pair in before if after.get(pair,0)<before[pair]]
    gained=[pair for pair in before if after.get(pair,0)>before[pair]]
    charge=lambda mol,i:mol.GetAtomWithIdx(i).GetFormalCharge()
    donors=[i for i in range(display.GetNumAtoms()) if charge(following,i)>charge(display,i)]
    acceptors=[i for i in range(display.GetNumAtoms()) if charge(following,i)<charge(display,i)]
    candidates=[]
    for pair in lost:
        candidates+=[Arrow(tail=list(pair),head=[atom]) for atom in pair if atom in acceptors]
        candidates+=[Arrow(tail=list(pair),head=list(other)) for other in gained if set(pair)&set(other)]
    for atom in donors:
        candidates+=[Arrow(tail=[atom],head=list(other)) for other in gained if atom in other]
    for size in range(1,most+1):
        for chosen in combinations(candidates,size):
            if len({tuple(a.tail) for a in chosen})<size:
                continue
            try:
                resonance_step(display,following,list(chosen))
                return list(chosen)
            except ValueError:
                continue
    return None

def resonance_result(block):
    """Resonance contributors on one shared layout, with curved arrows, and the hybrid."""
    validated, displays = [], []
    for contributor in block.contributors:
        mol, _ = molecule(contributor.smiles)
        validated.append(mol)
        displays.append(Chem.Mol(depiction_molecule(contributor.smiles, mol)))
    benzene=Chem.MolToSmiles(Chem.MolFromSmiles('c1ccccc1'))
    neutral_benzene=all(Chem.MolToSmiles(mol)==benzene and all(a.GetFormalCharge()==0 for a in mol.GetAtoms()) for mol in validated)
    if neutral_benzene:
        from .models import ResonanceContributor
        block=block.model_copy(update={'contributors':[
            ResonanceContributor(smiles='C1=CC=CC=C1',label='Kekulé contributor 1',arrows=[Arrow(tail=[0,1],head=[1,2]),Arrow(tail=[2,3],head=[3,4]),Arrow(tail=[4,5],head=[5,0])]),
            ResonanceContributor(smiles='C1C=CC=CC=1',label='Kekulé contributor 2')]})
        validated=[molecule(c.smiles)[0] for c in block.contributors]
        displays=[Chem.Mol(depiction_molecule(c.smiles,m)) for c,m in zip(block.contributors,validated)]
    first = displays[0]
    order = [a.GetSymbol() for a in first.GetAtoms()]
    pairs = {tuple(sorted((b.GetBeginAtomIdx(), b.GetEndAtomIdx()))) for b in first.GetBonds()}
    for mol, display in zip(validated[1:], displays[1:]):
        if ([a.GetSymbol() for a in display.GetAtoms()] != order
                or {tuple(sorted((b.GetBeginAtomIdx(), b.GetEndAtomIdx()))) for b in display.GetBonds()} != pairs
                or not resonance_form(mol, validated[0])):
            raise ValueError('Resonance contributors must use the same atoms in the same SMILES order and the same '
                             'connectivity, formula and net charge; only bond orders, charges and lone pairs may change.')
    # One layout for every contributor so the ring does not rotate between frames.
    rdDepictor.Compute2DCoords(first)
    positions = first.GetConformer().GetPositions()
    def place(mol):
        conformer = Chem.Conformer(mol.GetNumAtoms())
        for index, (x, y, z) in enumerate(positions):
            conformer.SetAtomPosition(index, (float(x), float(y), float(z)))
        mol.RemoveAllConformers(); mol.AddConformer(conformer, assignId=True)
        return mol
    contributors = []
    for number,(contributor, mol, display) in enumerate(zip(block.contributors, validated, displays)):
        item = {'smiles': contributor.smiles, 'label': contributor.label, 'arrows': [a.model_dump() for a in contributor.arrows],
                'formula': rdMolDescriptors.CalcMolFormula(mol), 'limitation': ''}
        try:
            if number+1<len(displays):
                following=displays[number+1]
                arrows=list(contributor.arrows)
                try:
                    if not arrows:
                        raise ValueError('No electron-flow arrows were supplied.')
                    resonance_step(display,following,arrows)
                except ValueError as problem:
                    # The structures are right but the arrows are missing or wrong: derive the
                    # electron-pair arrows that turn this contributor into the next one.
                    derived=infer_resonance_arrows(display,following)
                    if derived is None:
                        if not arrows:
                            raise ValueError('No electron-flow arrows were supplied, and none could be derived for this step.') from problem
                        raise
                    arrows=derived
                    item['arrows']=[a.model_dump() for a in arrows]
                    item['arrows_derived']=True
                contributor=contributor.model_copy(update={'arrows':arrows})
                target={tuple(sorted((b.GetBeginAtomIdx(),b.GetEndAtomIdx()))):b.GetBondTypeAsDouble() for b in following.GetBonds()}
                item['bond_changes']=[{'action':'CHANGE_BOND','label':'–'.join(display.GetAtomWithIdx(i).GetSymbol() for i in pair),'before':display.GetBondBetweenAtoms(*pair).GetBondTypeAsDouble(),'after':order} for pair,order in target.items() if display.GetBondBetweenAtoms(*pair).GetBondTypeAsDouble()!=order]

            item['svg'] = draw(place(display), contributor.arrows or [], keep_coords=True, lone_pairs=True, ring_flow=neutral_benzene)
        except ValueError as exc:
            item['svg'] = draw(place(Chem.Mol(display)), [], keep_coords=True, lone_pairs=True, ring_flow=neutral_benzene)
            item['limitation'] = str(exc)
        contributors.append(item)
    if neutral_benzene:
        # Identical canvas extents keep the ring skeletons level despite the
        # first contributor carrying electron-flow annotations.
        roots=[ET.fromstring(c['svg']) for c in contributors]
        boxes=[svg_bounds(root) for root in roots]
        union=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        for contributor,root in zip(contributors,roots):
            fit_svg(root, union)
            contributor['svg']=ET.tostring(root,encoding='unicode')
    hybrid = None
    # The hybrid follows from the structure alone, so aromatic rings always get it.
    aromatic = Chem.MolFromSmiles(block.contributors[0].smiles)
    if block.hybrid or any(atom.GetIsAromatic() for atom in aromatic.GetAtoms()):
        rings = [ring for ring in aromatic.GetRingInfo().AtomRings() if all(aromatic.GetAtomWithIdx(i).GetIsAromatic() for i in ring)]
        if rings:
            skeleton = Chem.RWMol(displays[0])
            ring_atoms = {i for ring in rings for i in ring}
            for bond in skeleton.GetBonds():
                if bond.GetBeginAtomIdx() in ring_atoms and bond.GetEndAtomIdx() in ring_atoms:
                    bond.SetBondType(Chem.BondType.SINGLE); bond.SetIsAromatic(False)
            for index in ring_atoms:
                skeleton.GetAtomWithIdx(index).SetFormalCharge(0); skeleton.GetAtomWithIdx(index).SetIsAromatic(False)
            skeleton.UpdatePropertyCache(strict=False)
            # Empty arrow list: same drawing scale as the contributors beside it.
            hybrid = {'svg': draw(place(skeleton.GetMol()), [], keep_coords=True, circles=rings), 'label': 'Resonance hybrid'}
    return {'contributors': contributors, 'hybrid': hybrid,**({'caption':'Benzene resonance contributors','flow_summary':'Three π-electron pairs shift together (2 e⁻ per arrow); the σ-bond framework stays intact.'} if neutral_benzene else {})}

BOND_SYMBOL = {Chem.BondType.SINGLE: '', Chem.BondType.DOUBLE: '=', Chem.BondType.TRIPLE: '#'}


def ordered_smiles(mol):
    """Kekulé SMILES whose atom order depends only on connectivity, so every resonance form
    of one molecule is written with the same atoms in the same order."""
    neighbours = {a.GetIdx(): sorted(n.GetIdx() for n in a.GetNeighbors()) for a in mol.GetAtoms()}
    seen, parent, closures, starts = set(), {}, [], []
    def visit(i):
        seen.add(i)
        for n in neighbours[i]:
            if n not in seen:
                parent[n] = i; visit(n)
            elif parent.get(i) != n and (n, i) not in closures:
                closures.append((i, n))
    for atom in range(mol.GetNumAtoms()):
        if atom not in seen:
            starts.append(atom); visit(atom)
    digits, opened = {}, {}
    for number, (a, b) in enumerate(closures):
        digits.setdefault(b, []).append(number); opened.setdefault(a, []).append(number)
    def token(i, plain):
        atom = mol.GetAtomWithIdx(i)
        if plain:
            return atom.GetSymbol()
        charge = atom.GetFormalCharge()
        hs = atom.GetTotalNumHs()
        return '[' + atom.GetSymbol() + ('H' + (str(hs) if hs > 1 else '') if hs else '') + ({1: '+', -1: '-'}.get(charge) or (f'{charge:+d}' if charge else '')) + ']'
    def write(plain):
        def walk(i):
            text = token(i, i in plain)
            for number in digits.get(i, []):
                text += str(number + 1) if number < 9 else f'%{number + 1}'
            for number in opened.get(i, []):
                a, b = closures[number]
                text += BOND_SYMBOL[mol.GetBondBetweenAtoms(a, b).GetBondType()] + (str(number + 1) if number < 9 else f'%{number + 1}')
            children = [n for n in neighbours[i] if parent.get(n) == i]
            for position, child in enumerate(children):
                part = BOND_SYMBOL[mol.GetBondBetweenAtoms(i, child).GetBondType()] + walk(child)
                text += part if position == len(children) - 1 else '(' + part + ')'
            return text
        return '.'.join(walk(start) for start in starts)
    plain = {a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() in ('B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I')
             and not a.GetFormalCharge() and not a.GetNumRadicalElectrons() and not a.GetIsotope()}
    for _ in range(2):
        smiles = write(plain)
        parsed = Chem.MolFromSmiles(smiles, sanitize=False)
        parsed.UpdatePropertyCache(strict=False)
        wrong = {i for i in plain if parsed.GetAtomWithIdx(i).GetTotalNumHs() != mol.GetAtomWithIdx(i).GetTotalNumHs()}
        if not wrong:
            return smiles
        plain -= wrong
    return write(set())


def _kekule_flips(mol):
    """The other Kekulé structure of each six-membered ring with alternating bonds."""
    flips = []
    Chem.FastFindRings(mol)
    for ring in mol.GetRingInfo().BondRings():
        if len(ring) != 6 or sorted(str(mol.GetBondWithIdx(i).GetBondType()) for i in ring) != ['DOUBLE'] * 3 + ['SINGLE'] * 3:
            continue
        flipped = Chem.RWMol(mol)
        for i in ring:
            bond = flipped.GetBondWithIdx(i)
            bond.SetBondType(Chem.BondType.SINGLE if bond.GetBondType() == Chem.BondType.DOUBLE else Chem.BondType.DOUBLE)
        try:
            Chem.SanitizeMol(flipped, Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_SETAROMATICITY)
            flips.append(flipped.GetMol())
        except Exception:
            continue
    return flips


def resonance_series(smiles, most=4):
    """Resonance contributors of one compound (Kekulé shifts and charge delocalisation), as
    SMILES with a shared atom order; fewer than two means the compound has no useful series."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return []
    forms = []
    for form in Chem.ResonanceMolSupplier(mol, Chem.KEKULE_ALL):
        if form is None:
            continue
        form = Chem.Mol(form)
        Chem.Kekulize(form, clearAromaticFlags=True)
        forms += [form, *_kekule_flips(form)]
    written = list(dict.fromkeys(ordered_smiles(form) for form in forms))
    # Chain the forms so each differs least from the one before (few arrows per step).
    def changes(a, b):
        first, second = Chem.MolFromSmiles(a, sanitize=False), Chem.MolFromSmiles(b, sanitize=False)
        bonds = sum(x.GetBondType() != second.GetBondBetweenAtoms(x.GetBeginAtomIdx(), x.GetEndAtomIdx()).GetBondType() for x in first.GetBonds())
        return bonds + sum(x.GetFormalCharge() != y.GetFormalCharge() for x, y in zip(first.GetAtoms(), second.GetAtoms()))
    series = written[:1]
    remaining = written[1:]
    while remaining and len(series) < most:
        following = min(remaining, key=lambda candidate: changes(series[-1], candidate))
        series.append(following); remaining.remove(following)
    return series


def expand_resonance(item, generate=False):
    """Resonance blocks ChemEZ can draw from what the model gave: one block per compound
    (a "benzene vs toluene" block becomes two), and contributors generated from the compound
    when the model gave one form, or when `generate` replaces forms that failed checks."""
    if not isinstance(item, dict) or item.get('type') != 'resonance' or not isinstance(item.get('contributors'), list):
        return [item]
    def readable(text):
        # The same lenient reading as drawing (O- and C+ written without brackets are repaired).
        try:
            return molecule(text)[0]
        except ValueError:
            return None
    given = [c for c in item['contributors'] if isinstance(c, dict) and isinstance(c.get('smiles'), str)]
    parsed = [readable(c['smiles']) for c in given]
    given = [{**c, 'smiles': Chem.MolToSmiles(m, kekuleSmiles=False) if m is not None and Chem.MolFromSmiles(c['smiles']) is None else c['smiles']} for c, m in zip(given, parsed)]
    if generate:
        # A compound the caption or labels name ("Resonance in the phenoxide ion") is the one to draw.
        words = re.findall(r"[a-z0-9,'()\-]+", ' '.join([str(item.get('caption', ''))] + [str(c.get('label', '')) for c in given]).lower())
        named = next((common_smiles(' '.join(words[i:i + n])) for n in (3, 2, 1) for i in range(len(words) - n + 1) if common_smiles(' '.join(words[i:i + n]))), None)
        if named and len(resonance_series(named)) >= 2:
            given, parsed = [{'smiles': named, 'label': ''}], [Chem.MolFromSmiles(named)]
        # Regenerate from the first readable structure; unreadable model forms are dropped.
        given, parsed = [c for c, m in zip(given, parsed) if m is not None][:1], [m for m in parsed if m is not None][:1]
    if not given or any(mol is None for mol in parsed):
        return [item]
    groups = []
    for contributor, mol in zip(given, parsed):
        for group in groups:
            if resonance_form(mol, group[0][1]):
                group.append((contributor, mol)); break
        else:
            groups.append([(contributor, mol)])
    distinct = len({c['smiles'].strip() for c in given})
    if len(groups) == 1 and distinct >= 2 and not generate:
        return [item]
    # Different compounds are split only when each is named (a comparison); an unnamed
    # non-contributor is a chemistry error the model is asked to fix.
    named = lambda contributor: bool(contributor.get('label')) and not re.search(r'contributor|form|structure|resonance|^[A-Z0-9]$', contributor['label'], re.I)
    if generate:
        groups = groups[:1]
    elif len(groups) > 1 and not all(named(group[0][0]) for group in groups):
        return [item]
    blocks = []
    for group in groups:
        first = group[0][0]
        name = re.sub(r'\s*(?:contributor|form|structure)\s*\d*$', '', first.get('label') or '', flags=re.I).strip()
        unique = list(dict.fromkeys(c['smiles'].strip() for c, _ in group))
        contributors = [{'smiles': c['smiles'], 'label': c.get('label', ''), 'arrows': c.get('arrows', [])} for c, _ in group] if len(unique) >= 2 and not generate else None
        if contributors is None:
            series = resonance_series(first['smiles'])
            contributors = [{'smiles': s, 'label': f'Contributor {number}'} for number, s in enumerate(series, 1)]
        if len(contributors) >= 2:
            caption = (item.get('caption') if len(groups) == 1 else '') or (f'Resonance in {name}' if name else '')
            blocks.append({'type': 'resonance', 'caption': caption or '', 'hybrid': bool(item.get('hybrid', True)), 'contributors': contributors})
        else:
            blocks.append({'type': 'molecule', 'smiles': first['smiles'], 'label': f'{name or first.get("label", "")} (no resonance contributors)'.strip()})
    return blocks


_HALIDES = {'F': 'fluoride ion', 'Cl': 'chloride ion', 'Br': 'bromide ion', 'I': 'iodide ion'}

def complete_leaving_ions(panels):
    """Add a halide the model forgot to draw after it leaves (e.g. SN2 products 'CO' -> 'CO.[Br-]').

    Only when a later panel is short by exactly one halogen atom and one negative charge
    relative to the first panel, so nothing else about the mechanism is guessed."""
    out, added = list(panels), [''] * len(panels)
    first = Chem.MolFromSmiles(panels[0]) if panels else None
    if first is None:
        return out, added
    def inventory(mol):
        counts = {}
        for atom in mol.GetAtoms():
            counts[atom.GetSymbol()] = counts.get(atom.GetSymbol(), 0) + 1
        return counts, Chem.GetFormalCharge(mol)
    start, charge = inventory(first)
    for index in range(1, len(panels)):
        mol = Chem.MolFromSmiles(panels[index])
        if mol is None:
            continue
        counts, total = inventory(mol)
        missing = {k: start.get(k, 0) - counts.get(k, 0) for k in set(start) | set(counts)}
        missing = {k: v for k, v in missing.items() if v}
        if len(missing) == 1 and list(missing.values())[0] == 1 and list(missing)[0] in _HALIDES and total - charge == 1:
            symbol = list(missing)[0]
            out[index] = panels[index] + f'.[{symbol}-]'
            added[index] = _HALIDES[symbol]
    return out, added

def _friendly(problem):
    text = str(problem)
    found = re.search(r'Explicit valence for atom # ?(\d+) (\w+), (\d+)', text)
    if found:
        return (f'Following these arrows would give the {found.group(2)} atom (index {found.group(1)}) {found.group(3)} bonds. '
                'Add the arrow that breaks its bond to the leaving group (bond → leaving atom), or correct the arrows.')
    return text

def verify_or_complete(mol, following, arrows):
    """Verify the model's mechanism arrows; if they fail, find the smallest valid set (up to three
    arrows, keeping as many of the model's as possible) with the same electron-pair checker. Returns
    (arrows, bond changes, derived?). Raises a plain-language ValueError if nothing fits."""
    from itertools import combinations
    from .electron_flow import verify_pair_step
    try:
        if arrows:
            return arrows, verify_pair_step(mol, following, arrows), False
        raise ValueError('No electron-flow arrows were supplied.')
    except ValueError as problem:
        first_problem = problem
    if mol.GetNumHeavyAtoms() > 16:
        raise ValueError(_friendly(first_problem))
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in mol.GetBonds()
             if b.GetBeginAtom().GetAtomicNum() > 1 and b.GetEndAtom().GetAtomicNum() > 1]
    donors = [a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum() > 1 and (a.GetFormalCharge() < 0 or a.GetSymbol() in ('N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'))]
    heavy = [a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum() > 1]
    candidates = []
    for a, b in bonds:
        candidates += [Arrow(tail=[a, b], head=[b]), Arrow(tail=[a, b], head=[a])]
    for d in donors:
        candidates += [Arrow(tail=[d], head=[d, t]) for t in heavy if t != d and mol.GetBondBetweenAtoms(d, t) is None]
        candidates += [Arrow(tail=[d], head=[d, t]) for t in heavy if t != d and mol.GetBondBetweenAtoms(d, t) is not None]
    def attempt(chosen):
        try:
            return verify_pair_step(mol, following, chosen)
        except ValueError:
            return None
    # Smallest valid set, preferring the one that keeps the most of the model's own arrows:
    # right-but-incomplete arrows are kept, wrong ones replaced, never kept and "balanced".
    def key(a):
        # Atom -> atom is shorthand for a lone pair forming that bond: same arrow as atom -> bond.
        if len(a.tail) == 1 and len(a.head) == 1 and a.tail != a.head:
            return (tuple(a.tail), tuple(sorted(a.tail + a.head)))
        return (tuple(a.tail), tuple(sorted(a.head)) if len(a.head) == 2 else tuple(a.head))
    given = {key(a): a for a in arrows}
    for size in (1, 2, 3):
        found = []
        for chosen in combinations(candidates, size):
            changes = attempt(list(chosen))
            if changes is not None:
                found.append((sum(key(a) in given for a in chosen), list(chosen), changes))
        if found:
            _, chosen, changes = max(found, key=lambda item: item[0])
            # Show the model's own form (and curve direction) for every arrow it got right.
            return [given.get(key(a), a) for a in chosen], changes, True
    raise ValueError(_friendly(first_problem))

def render_block(block):
    result = block.model_dump()
    result['id'] = str(uuid4())
    if block.type == 'molecule':
        result.update(molecule_result(block))
    elif block.type == 'reaction':
        # Models sometimes spell absent annotations as strings instead of omitting them.
        absent={'none','null','n/a','not applicable','no reagents','no conditions','-','—'}
        block=block.model_copy(update={field:'' if getattr(block,field).strip().casefold() in absent else getattr(block,field) for field in ('reagents','conditions')})
        result.update(block.model_dump())
        if len(block.reactants)==len(block.products)==1:
            left=molecule_result(block.reactants[0]);right=molecule_result(block.products[0])
            if left['smiles']==right['smiles']:
                from .models import MoleculeBlock
                return render_block(MoleculeBlock(type='molecule',**block.reactants[0].model_dump()))
        result.update(reaction_result(block))
    elif block.type == 'resonance':
        result.update(resonance_result(block))
    elif block.type == 'mechanism':
        result['steps'] = []
        inventory=None
        panels, added = complete_leaving_ions([step.smiles for step in block.steps])
        for number,step in enumerate(block.steps):
            item = step.model_dump()
            if panels[number]!=step.smiles:
                step = step.model_copy(update={'smiles':panels[number]})
                item['smiles'] = panels[number]
                item['completed'] = f'ChemEZ added the {added[number]} released in this step.'
            try:
                mol,formula = molecule(step.smiles,preserve_hydrogens=True)
                known=common_smiles(step.iupac_name,step.label)
                if known and not same_compound(mol,Chem.MolFromSmiles(known)) and not resonance_form(mol,Chem.MolFromSmiles(known)):
                    raise ValueError('This mechanism panel names a different compound from its structure. Correct the SMILES and arrow anchors together.')
                if re.search(r'oxonium',step.label,re.I) and not any(a.GetAtomicNum()==8 and a.GetFormalCharge()>0 for a in mol.GetAtoms()):
                    raise ValueError('This panel names an oxonium ion but draws no positively charged oxygen.')
                state=(normalize_formula(formula)[0],sum(atom.GetFormalCharge() for atom in mol.GetAtoms()))
                if inventory is None:
                    inventory=state
                elif state!=inventory:
                    raise ValueError('The atom inventory or total charge changes between mechanism panels. Include all participating species before drawing this step.')
                item['formula']=formula
                item['iupac_name'],item['name_source']=structure_name(step.smiles,step.iupac_name)
                if number+1<len(block.steps):
                    following,_=molecule(panels[number+1],preserve_hydrogens=True)
                    arrows,changes,derived=verify_or_complete(mol,following,list(step.arrows))
                    item['bond_changes']=changes
                    if derived:
                        step=step.model_copy(update={'arrows':arrows})
                        item['arrows']=[a.model_dump() for a in arrows]
                        item['arrows_derived']=True
                item['svg'] = draw(mol, step.arrows or [], lone_pairs=True)
                if number==len(block.steps)-1 and step.arrows:
                    item['limitation']='No following panel was supplied, so the destination of these arrows could not be verified.'
                if number+1<len(block.steps) and not step.arrows and not step.limitation:
                    item['limitation'] = 'No electron-flow arrows were supplied for this intermediate.'
            except ValueError as exc:
                item['limitation'] = str(exc)
                # Do not show a partial or incorrect arrow diagram.
                item['svg'] = None
            result['steps'].append(item)
    return result

_SIMPLE = {'H2O':('O','Water'),'CO2':('O=C=O','Carbon dioxide'),'NH3':('N','Ammonia'),'CH4':('C','Methane')}

def formula_only_question(text):
    """Catch formula-only structure requests before asking a model to guess an isomer."""
    cleaned = text.strip().translate(str.maketrans('₀₁₂₃₄₅₆₇₈₉','0123456789'))
    # Explicitly underspecified formula questions remain ambiguous even when a user
    # adds a sentence describing the missing information.
    if re.search(r'no (?:other|identifying)|forgot (?:the )?name|without guessing',cleaned,re.I) and not re.search(r'isomers|ethanol|ether|propan|methanol',cleaned,re.I):
        formulas=re.findall(r'\b(?:[A-Z][a-z]?\d*){2,15}\b',cleaned)
        if len(set(formulas))==1:
            cleaned=formulas[0]
    match = re.fullmatch(r'(?:(?i:(?:please\s+)?(?:draw|convert|show|give|what is)(?:\s+(?:the|a|molecular|structure|of|for|smiles))*\s+))?((?:[A-Z][a-z]?\d*){1,15})(?i:\s+(?:to\s+)?(?:SMILES|structure))?[?.!]?\s*', cleaned)
    if not match:
        return None
    formula = match.group(1)
    if formula in _SIMPLE:
        smiles,label = _SIMPLE[formula]
        from .models import MoleculeBlock
        return render_block(MoleculeBlock(type='molecule',smiles=smiles,label=label,formula=formula))
    return {'id':str(uuid4()),'type':'clarification','question':f'{formula} alone does not specify the atom connectivity. Which compound do you mean, or would you like possible isomers?', 'options':['Show possible isomers', 'I will provide the compound name or SMILES']}

def structure_3d(smiles: str):
    """3D conformer (ETKDG + MMFF, approach from chem-skill/ChemClaw) and RDKit descriptors."""
    from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski
    mol, formula = molecule(smiles)
    properties = {
        'formula': formula,
        'molar_mass': round(Descriptors.MolWt(mol), 2),
        'exact_mass': round(Descriptors.ExactMolWt(mol), 4),
        'logp': round(Crippen.MolLogP(mol), 2),
        'tpsa': round(rdMolDescriptors.CalcTPSA(mol), 1),
        'h_bond_donors': Lipinski.NumHDonors(mol),
        'h_bond_acceptors': Lipinski.NumHAcceptors(mol),
        'rotatable_bonds': Lipinski.NumRotatableBonds(mol),
        'rings': rdMolDescriptors.CalcNumRings(mol),
        'aromatic_rings': rdMolDescriptors.CalcNumAromaticRings(mol),
        'stereocentres': len(Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)),
        'formal_charge': Chem.GetFormalCharge(mol),
        'heavy_atoms': mol.GetNumHeavyAtoms(),
    }
    hydrogens = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    if AllChem.EmbedMolecule(hydrogens, params) != 0:
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(hydrogens, params) != 0:
            return {'molblock': None, 'force_field': None, 'properties': properties}
    force_field = 'MMFF94'
    try:
        if AllChem.MMFFHasAllMoleculeParams(hydrogens):
            AllChem.MMFFOptimizeMolecule(hydrogens, maxIters=2000)
        else:
            force_field = 'UFF'
            AllChem.UFFOptimizeMolecule(hydrogens, maxIters=2000)
    except (ValueError, RuntimeError):
        force_field = None
    return {'molblock': Chem.MolToMolBlock(hydrogens), 'force_field': force_field, 'properties': properties}


# Functional groups for the teaching view (SMARTS written for ChemEZ; idea from chemdraw-mcp/openmolclaw).
_GROUPS = [
    ('Carboxylic acid', '[CX3](=O)[OX2H1]'), ('Carboxylate', '[CX3](=O)[OX1-]'), ('Acyl chloride', '[CX3](=O)[Cl]'),
    ('Acid anhydride', '[CX3](=O)[OX2][CX3](=O)'), ('Ester', '[CX3;$(C[#6])](=O)[OX2H0;$(O[#6])]'), ('Amide', '[NX3][CX3](=[OX1])'),
    ('Aldehyde', '[CX3H1](=O)'), ('Ketone', '[CX3;$(C([#6])[#6])]=O'), ('Nitrile', '[CX2]#[NX1]'), ('Nitro group', '[N+](=O)[O-]'),
    ('Sulfonic acid', '[SX4](=O)(=O)[OX2H1]'), ('Phenol', '[OX2H1;$(Oc)]'), ('Alcohol', '[OX2H1;$(O[CX4])]'),
    ('Ether', '[OD2;$(O([#6;!$(C=O)])[#6;!$(C=O)])]'), ('Amine', '[NX3;!$(N[C,S]=[O,S,N]);!$(N[#7,#8]);!$(N-a)]'), ('Aniline-type amine', '[NX3;H2,H1;!$(NC=O)]c'),
    ('Imine', '[CX3]=[NX2]'), ('Thiol', '[SX2H1]'), ('Alkene', '[CX3]=[CX3]'), ('Alkyne', '[CX2]#[CX2]'),
    ('Aryl halide', 'c[F,Cl,Br,I]'), ('Haloalkane', '[CX4][F,Cl,Br,I]'), ('Benzene ring', 'c1ccccc1'),
]
_GROUP_PATTERNS = [(name, Chem.MolFromSmarts(smarts)) for name, smarts in _GROUPS]

def functional_groups(mol):
    groups, claimed = [], set()
    for name, pattern in _GROUP_PATTERNS:
        matches = [m for m in mol.GetSubstructMatches(pattern) if not (name in ('Ketone', 'Ether', 'Alcohol', 'Aldehyde') and set(m) <= claimed)]
        if not matches:
            continue
        atoms = sorted({i for m in matches for i in m})
        if name != 'Benzene ring':
            claimed.update(atoms)
        groups.append({'name': name, 'count': len(matches), 'atoms': atoms})
    return groups

def stereo_labels(mol):
    from rdkit.Chem import rdCIPLabeler
    labelled = Chem.Mol(mol)
    try:
        rdCIPLabeler.AssignCIPLabels(labelled)
    except (ValueError, RuntimeError):
        return []
    labels = [f"{a.GetSymbol()}{a.GetIdx()+1}: {a.GetProp('_CIPCode')}" for a in labelled.GetAtoms() if a.HasProp('_CIPCode')]
    labels += [f"Double bond {b.GetBeginAtomIdx()+1}–{b.GetEndAtomIdx()+1}: {b.GetProp('_CIPCode')}" for b in labelled.GetBonds() if b.HasProp('_CIPCode')]
    return labels


def add_lone_pairs(root, drawer, display, bounds, sites=None):
    """Lone pairs as two dots and radicals as one dot, placed in the widest free directions
    around the atom. Directions taken by bonds, the H of an OH/NH label and the charge sign
    (drawn at the upper right) are kept clear."""
    import math
    total_pairs=0
    table=Chem.GetPeriodicTable()
    sites={} if sites is None else sites  # atom index -> dot-pair centres, for arrow tails
    for atom in display.GetAtoms():
        # Limit to main-group atoms with an ordinary Lewis electron count.
        if atom.GetAtomicNum() not in {5,6,7,8,9,14,15,16,17,35,53}:continue
        radicals=atom.GetNumRadicalElectrons()
        electrons=table.GetNOuterElecs(atom.GetAtomicNum())-atom.GetTotalValence()-atom.GetFormalCharge()-radicals
        count=max(0,int(electrons)//2)
        if count>4:continue
        total_pairs+=count
        if not count and not radicals:continue
        point=drawer.GetDrawCoords(atom.GetIdx())
        taken=[math.atan2(drawer.GetDrawCoords(n.GetIdx()).y-point.y,drawer.GetDrawCoords(n.GetIdx()).x-point.x)%(2*math.pi) for n in atom.GetNeighbors()]
        if atom.GetTotalNumHs() and atom.GetAtomicNum()!=6:
            # The label's H sits on the side away from the bonds.
            mean=sum(math.cos(t) for t in taken)
            taken.append(0.0 if mean<=0 else math.pi)
        if atom.GetFormalCharge():
            taken.append(7*math.pi/4)
        slots=count+radicals
        # Textbook placement: dots sit above, below, left or right of the symbol when those
        # sides are free; diagonals only when a cardinal side is taken.
        def clearance(angle):
            return min((abs((angle-t+math.pi)%(2*math.pi)-math.pi) for t in taken),default=math.pi)
        candidates=[i*math.pi/4 for i in range(8)]
        directions=[]
        for _ in range(slots):
            free=[c for c in candidates if c not in directions]
            best=max(free,key=lambda c:(min(clearance(c),*(abs((c-d+math.pi)%(2*math.pi)-math.pi) for d in directions)) if directions else clearance(c))+(.3 if c%(math.pi/2)==0 else 0))
            directions.append(best)
        # Radicals take the last slot(s); pairs the rest.
        for index,angle in enumerate(directions):
            single=index>=count
            cx=point.x+15*math.cos(angle);cy=point.y+15*math.sin(angle)
            sites.setdefault(atom.GetIdx(),[]).append((cx,cy))
            for offset in ((0,) if single else (-2.6,2.6)):
                x=cx-offset*math.sin(angle);y=cy+offset*math.cos(angle)
                ET.SubElement(root,f'{{{SVG}}}circle',{'cx':f'{x:.2f}','cy':f'{y:.2f}','r':'1.7' if single else '1.45','fill':'#172d35','class':'radical-electron' if single else 'lone-pair-electron','data-atom':str(atom.GetIdx())})
                bounds=[min(bounds[0],x-5),min(bounds[1],y-5),max(bounds[2],x+5),max(bounds[3],y+5)]
    root.set('data-lone-pairs',str(total_pairs))
    return bounds

def lewis_drawing(mol, explicit_hydrogens=False, pairs=True):
    """CPU-only depiction; lone pairs follow valence, formal charge and radicals."""
    import math
    display=Chem.AddHs(mol) if explicit_hydrogens else Chem.Mol(mol)
    if display.GetNumAtoms()>250:
        return None
    rdDepictor.Compute2DCoords(display)
    spread_fragments(display)
    drawer=rdMolDraw2D.MolDraw2DSVG(-1,-1)
    options=drawer.drawOptions()
    options.fixedBondLength=28
    options.clearBackground=False
    if explicit_hydrogens:
        for atom in display.GetAtoms():
            if atom.GetAtomicNum()==6 and not atom.GetFormalCharge() and not atom.GetIsotope() and not atom.GetNumRadicalElectrons():
                options.atomLabels[atom.GetIdx()]='C'
    options.fixedFontSize=16
    options.padding=.24
    options.addStereoAnnotation=True
    options.updateAtomPalette(ATOM_PALETTE)
    drawer.DrawMolecule(display);drawer.FinishDrawing()
    root=ET.fromstring(drawer.GetDrawingText());root.set('role','img')
    bounds=svg_bounds(root)
    if pairs:bounds=add_lone_pairs(root,drawer,display,bounds)
    fit_svg(root, bounds)
    return ET.tostring(root,encoding='unicode')

def analyse(smiles: str):
    """Teaching view: functional groups with highlighted drawings, CIP stereo labels and identifiers."""
    mol, _ = molecule(smiles)
    groups = functional_groups(mol)
    for group in groups:
        group['svg'] = draw(Chem.Mol(mol), highlight=group['atoms'])
    try:
        inchi = Chem.MolToInchi(mol)
        key = Chem.InchiToInchiKey(inchi) if inchi else ''
    except (ValueError, RuntimeError):
        inchi, key = '', ''
    return {'lewis_svg':lewis_drawing(mol),'hydrogens_svg':lewis_drawing(mol,True,False),'lewis_hydrogens_svg':lewis_drawing(mol,True,True),'groups': groups, 'stereo_svg': draw(Chem.Mol(mol), stereo=True), 'stereo': stereo_labels(mol), 'inchi': inchi, 'inchikey': key}

def mark_changes(left, right):
    """Highlight atoms outside the maximum common substructure of the main reactant and product."""
    from rdkit.Chem import rdFMCS
    heavy = lambda item: Chem.MolFromSmiles(item['smiles']).GetNumHeavyAtoms()
    if not left or not right:
        return
    product = max(right, key=heavy)
    product_mol = Chem.MolFromSmiles(product['smiles'])
    if product_mol.GetNumHeavyAtoms() < 2:
        return
    # The main reactant is the one sharing the largest common substructure with the product.
    best = None
    for item in left:
        mol = Chem.MolFromSmiles(item['smiles'])
        if mol.GetNumHeavyAtoms() < 2:
            continue
        found = rdFMCS.FindMCS([mol, product_mol], timeout=1, ringMatchesRingOnly=True, completeRingsOnly=True)
        if found.numAtoms and not found.canceled and (best is None or found.numAtoms > best[2].numAtoms):
            best = (item, mol, found)
    if best is None:
        return
    reactant, reactant_mol, result = best
    mols = [reactant_mol, product_mol]
    core = Chem.MolFromSmarts(result.smartsString)
    for item, mol in ((reactant, mols[0]), (product, mols[1])):
        kept = set(mol.GetSubstructMatch(core))
        changed = [a.GetIdx() for a in mol.GetAtoms() if a.GetIdx() not in kept]
        if kept and changed:
            item['svg_changes'] = draw(Chem.Mol(depiction_molecule(item['smiles'], mol)), highlight=changed)
