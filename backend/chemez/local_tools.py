"""Bounded, offline calculations. Heavy helpers load only for matching requests."""
import math
import re
from fractions import Fraction
from functools import lru_cache


def formula_info(text):
    if len(text)>100 or not re.fullmatch(r'[A-Za-z0-9()[\].]+',text):
        raise ValueError('Use a neutral molecular formula of at most 100 characters.')
    if any(int(number)>10000 for number in re.findall(r'\d+',text)):
        raise ValueError('Formula atom counts are too large.')
    from molmass import Formula
    f=Formula(text)
    composition=f.composition().asdict()
    return {'formula':f.formula,'mass':f.mass,'exact_mass':f.isotope.mass,'composition':{symbol:int(row[0]) for symbol,row in composition.items()}}


@lru_cache(maxsize=1)
def _units():
    from pint import UnitRegistry
    return UnitRegistry(cache_folder=None)


def convert(value,source,target):
    if not math.isfinite(value) or abs(value)>1e100:
        raise ValueError('Value is outside the supported range.')
    for unit in (source,target):
        if len(unit)>60 or not re.fullmatch(r'[A-Za-zµμ°0-9 /*^.-]+',unit):
            raise ValueError('Unsupported unit expression.')
        if any(abs(int(n))>12 for n in re.findall(r'[-+]?\d+',unit)):
            raise ValueError('Unit exponents are too large.')
    u=_units()
    converted=u.Quantity(value,source).to(target)
    result=float(converted.magnitude)
    if not math.isfinite(result):raise ValueError('Conversion is not finite.')
    return result


def balance(equation):
    """Unique neutral-species balance using exact rational elimination, not an ML solver."""
    sides=re.split(r'\s*(?:->|→|=)\s*',equation)
    if len(sides)!=2:raise ValueError('Use reactants -> products.')
    species=[side.split('+') for side in sides]
    species=[[re.sub(r'^\d+\s*','',part.strip()) for part in side] for side in species]
    left,right=species;names=left+right
    if not left or not right or not 2<=len(names)<=12:raise ValueError('Use 2 to 12 neutral species.')
    inventory=[formula_info(name)['composition'] for name in names]
    elements=sorted(set().union(*inventory));n=len(names)
    matrix=[[Fraction(counts.get(element,0)*(1 if i<len(left) else -1)) for i,counts in enumerate(inventory)] for element in elements]
    row=0;pivots=[]
    for col in range(n):
        pivot=next((i for i in range(row,len(matrix)) if matrix[i][col]),None)
        if pivot is None:continue
        matrix[row],matrix[pivot]=matrix[pivot],matrix[row]
        divisor=matrix[row][col];matrix[row]=[x/divisor for x in matrix[row]]
        for i in range(len(matrix)):
            if i!=row:
                factor=matrix[i][col];matrix[i]=[a-factor*b for a,b in zip(matrix[i],matrix[row])]
        pivots.append(col);row+=1
        if row==len(matrix):break
    free=[i for i in range(n) if i not in pivots]
    if len(free)!=1:raise ValueError('This equation has no unique balance with the supplied species.')
    values=[Fraction(0)]*n;values[free[0]]=Fraction(1)
    for i,col in reversed(list(enumerate(pivots))):values[col]=-sum(matrix[i][j]*values[j] for j in free)
    scale=math.lcm(*(v.denominator for v in values));coefficients=[int(v*scale) for v in values]
    if all(c<0 for c in coefficients):coefficients=[-c for c in coefficients]
    if any(c<=0 for c in coefficients):raise ValueError('The supplied reactant/product sides cannot be balanced as written.')
    divisor=math.gcd(*coefficients);coefficients=[c//divisor for c in coefficients]
    terms=[(str(c)+' ' if c!=1 else '')+name for c,name in zip(coefficients,names)]
    return ' + '.join(terms[:len(left)])+' → '+' + '.join(terms[len(left):])


def answer(question):
    """Only intercept unambiguous standalone tool requests; leave other tutoring to the model."""
    text=re.sub(r'^\s*/calc\s+','',question,flags=re.I).strip().rstrip('?.')
    if len(text)>350:return None
    match=re.fullmatch(r'(?:convert\s+)?([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s+(.+?)\s+(?:to|in)\s+([A-Za-zµμ°][A-Za-zµμ°0-9 /*^.-]*)',text,re.I)
    element=re.fullmatch(r'(?:atomic|element) properties (?:of\s+)?([A-Za-z]+)',text,re.I)
    mass=re.fullmatch(r'(?:molar|molecular|exact) mass (?:of\s+)?([A-Z][A-Za-z0-9()[\].]*)',text)
    equation=re.fullmatch(r'(?:balance|balance the equation)\s+([A-Za-z0-9()[\].+ =→>-]+)',text,re.I)
    if not (match or mass or equation or element):return None
    try:
        if element:
            from molmass.elements import ELEMENTS
            name=element[1].lower()
            item=next((e for e in ELEMENTS if e.symbol.lower()==name or e.name.lower()==name),None)
            if item is None:return None
            return (f'**{item.name} ({item.symbol})**. Offline elemental reference from Molmass.\n\n'
                    f'| Property | Value |\n|---|---|\n| Atomic number | {item.number} |\n| Standard atomic weight | {item.mass} |\n| Group / period | {item.group} / {item.period} |\n| Electron configuration | {item.eleconfig} |\n| Electronegativity (Pauling) | {item.eleneg or "Not available"} |')
        if match:
            value=float(match[1]);result=convert(value,match[2],match[3])
            return f'Using compatible units and local unit conversion:\n\n**Answer:** {value:g} {match[2]} = **{result:.8g} {match[3]}**.'
        if mass:
            facts=formula_info(mass[1]);exact=text.startswith('exact')
            return f'Calculated locally from the elemental composition of {facts["formula"]}.\n\n**Answer:** {facts["exact_mass"] if exact else facts["mass"]:.6f} {"Da (monoisotopic mass)" if exact else "g/mol (average molar mass)"}.'
        result=balance(equation[1])
        return f'Balanced locally by conserving every element with positive integer coefficients:\n\n**Answer:** {result}\n\nAtom balance alone does not establish that a reaction occurs.'
    except Exception:
        return 'This local calculation could not be completed reliably. Check the formula, compatible units, or reactant/product sides. Ionic and underdetermined balances require a more specific question.'


def isotope_table(formula):
    """Natural-abundance singly charged molecular-ion envelope, not fragmentation."""
    facts=formula_info(formula)
    if sum(facts['composition'].values())>200:return None
    from molmass import Formula
    rows=sorted(Formula(formula).spectrum().asdict().values(),key=lambda entry:-entry[2])[:20]
    rows=sorted((row for row in rows if row[2]>=.1),key=lambda row:row[0])
    return ('**MS isotope envelope (calculated)**\n\n'
            '| m/z | Relative intensity (%) | Assignment |\n|---|---|---|\n'
            +'\n'.join(f'| {mass-0.00054858:.4f} | {intensity:.2f} | Natural-abundance molecular ion, z = +1 |' for mass,fraction,intensity,mz in rows)
            +'\n\nCalculated locally from natural isotope abundances using Molmass. Assumes a singly charged molecular ion; it does not predict ion formation, fragmentation, or experimental detector response.')
