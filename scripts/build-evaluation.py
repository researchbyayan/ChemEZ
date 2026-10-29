"""Create reproducible chemistry fixtures and the 25+25 prompt corpus. No API calls."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from rdkit import Chem
from rdkit.Chem import Draw

root = Path(__file__).resolve().parents[1] / 'evaluation'
fixtures = root / 'fixtures'
fixtures.mkdir(parents=True, exist_ok=True)
organic = 'https://openstax.org/books/organic-chemistry/pages/'
general = 'https://openstax.org/books/chemistry-2e/pages/'
rows = [
 ('Draw benzene and give its molecular formula.', ['C6H6'], ['c1ccccc1'], 'Benzene is C6H6 and aromatic.', organic+'15-2-structure-and-stability-of-benzene'),
 ('Draw ethanol and identify its functional group.', ['C2H6O','alcohol'], ['CCO'], 'Ethanol is a primary alcohol, C2H6O.', organic+'17-1-naming-alcohols-and-phenols'),
 ('Show aspirin and identify its ester and carboxylic acid groups.', ['C9H8O4','ester','acid'], ['CC(=O)Oc1ccccc1C(=O)O'], 'Aspirin contains an ester and a carboxylic acid.', organic+'21-6-chemistry-of-esters'),
 ('Draw caffeine and state its molecular formula.', ['C8H10N4O2'], ['Cn1c(=O)c2c(ncn2C)n(C)c1=O'], 'Caffeine is C8H10N4O2.', 'https://pubchem.ncbi.nlm.nih.gov/compound/Caffeine'),
 ('Draw both enantiomers of lactic acid and explain what makes them different.', ['enantiomer'], [], 'Opposite stereochemistry at the single stereocentre; C3H6O3.', organic+'5-1-enantiomers-and-the-tetrahedral-carbon'),
 ('Draw C2H6O. I have supplied no other identifying information.', [], [], 'Clarify ethanol versus dimethyl ether, or show explicitly labeled alternatives.', organic+'3-2-alkanes-and-alkane-isomers'),
 ('Show every constitutional isomer with formula C3H8O.', ['C3H8O'], ['CCCO','CC(O)C','COCC'], 'Propan-1-ol, propan-2-ol and methoxyethane.', organic+'3-2-alkanes-and-alkane-isomers'),
 ('Draw the two Kekulé contributors of benzene and explain the real bonding.', ['delocal'], ['c1ccccc1'], 'Two equivalent contributors; actual benzene has delocalized bonds, not alternating molecules.', organic+'15-2-structure-and-stability-of-benzene'),
 ('Explain the geometry and approximate bond angle of methane, with a drawing.', ['tetrahedral','109'], ['C'], 'Tetrahedral, approximately 109.5 degrees.', organic+'1-6-sp3-hybrid-orbitals-and-the-structure-of-methane'),
 ('Draw cis-but-2-ene and trans-but-2-ene side by side with their stereochemistry.', [], [], 'Z and E but-2-ene are distinct geometric isomers, C4H8.', organic+'7-4-cis-trans-isomerism-in-alkenes'),
 ('Draw the oxidation of ethanol using PCC under anhydrous conditions.', ['ethanal'], ['CCO','CC=O'], 'Primary alcohol gives ethanal with PCC.', organic+'17-7-oxidation-of-alcohols'),
 ('What does excess aqueous dichromate under reflux do to ethanol? Draw the reaction.', ['acid'], ['CCO','CC(=O)O'], 'Ethanoic acid under forcing aqueous oxidizing conditions.', organic+'17-7-oxidation-of-alcohols'),
 ('Reduce acetone with sodium borohydride and show the organic product.', [], ['CC(C)=O','CC(C)O'], 'Propan-2-ol is the reduction product.', organic+'19-7-nucleophilic-addition-of-hydride-and-grignard-reagents-alcohol-formation'),
 ('Draw the acid-catalyzed esterification of ethanol and ethanoic acid.', ['water'], ['CCO','CC(=O)O','CCOC(C)=O'], 'Ethyl ethanoate and water, reversible acid-catalyzed reaction.', organic+'21-6-chemistry-of-esters'),
 ('Show the SN2 mechanism for hydroxide and bromomethane with electron arrows.', ['backside'], ['CO'], 'One concerted displacement gives methanol and bromide, no carbocation.', organic+'11-2-the-sn2-reaction'),
 ('Explain the SN1 hydrolysis of tert-butyl bromide with a mechanism.', ['carbocation'], ['CC(C)(C)O'], 'Ionization to tertiary carbocation then water attack and deprotonation.', organic+'11-4-the-sn1-reaction'),
 ('Show the E2 reaction of tert-butyl bromide with strong base and heat.', [], ['C=C(C)C'], '2-Methylpropene forms by concerted elimination.', organic+'11-8-the-e2-reaction-and-the-deuterium-isotope-effect'),
 ('Show benzene reacting with bromine and FeBr3. State the reaction class.', ['substitution'], ['c1ccccc1','Brc1ccccc1'], 'Bromobenzene by electrophilic aromatic substitution.', organic+'16-1-electrophilic-aromatic-substitution-reactions-bromination'),
 ('Does benzene plus HCl alone give chlorobenzene? Explain and show an appropriate alternative.', [], ['Clc1ccccc1'], 'No ordinary substitution with HCl alone; Cl2/FeCl3 is a suitable chlorination.', organic+'16-1-electrophilic-aromatic-substitution-reactions-bromination'),
 ('Draw a Williamson ether synthesis of anisole from phenol.', [], ['Oc1ccccc1','COc1ccccc1'], 'Phenoxide reacts with a methyl electrophile by SN2.', organic+'18-2-synthesis-of-ethers'),
 ('Use structures to explain why phenol is more acidic than ethanol.', ['resonance'], ['Oc1ccccc1','CCO'], 'Phenoxide is resonance stabilized; ethoxide lacks that stabilization.', organic+'17-2-properties-of-alcohols-and-phenols'),
 ('A buffer has equal concentrations of acetic acid and acetate. Given pKa=4.76, calculate pH.', ['4.76'], [], 'Henderson-Hasselbalch gives pH = 4.76.', general+'14-6-buffers'),
 ('Calculate the pH of 0.0010 M HCl at 25 degrees C, assuming ideal dilute behavior.', ['3.00'], [], 'Strong acid pH is 3.00 to two decimal places.', general+'14-2-ph-and-poh'),
 ('Balance the complete combustion of ethane and explain your atom counts.', [], [], '2 C2H6 + 7 O2 gives 4 CO2 + 6 H2O.', general+'4-1-writing-and-balancing-chemical-equations'),
 ('Draw the aldol addition product from two ethanal molecules under dilute base, without dehydration.', [], ['CC(O)CC=O'], '3-Hydroxybutanal is the aldol addition product.', organic+'23-1-carbonyl-condensations-the-aldol-reaction'),
]
custom = [
 ('I wrote C2H6O on a bottle, but forgot the name. Can you identify its connectivity without guessing?', [], [], 'Clarify the identity or label the isomers; formula alone is ambiguous.'),
 ('My worksheet says benzene + HCl gives chlorobenzene and H2. Find the error and draw a corrected route.', [], ['Clc1ccccc1'], 'Reject the proposed route; use Cl2/FeCl3.'),
 ('My teacher requests benzaldehyde from benzene. Draw the standard Gattermann–Koch route, not acetone.', [], ['O=Cc1ccccc1'], 'Use CO/HCl with AlCl3/CuCl, correct aldehyde drawing.'),
 ('I have phenol and want anisole. Give the shortest sensible two-stage scheme and explain why the alkyl halide should be methyl.', [], ['Oc1ccccc1','COc1ccccc1'], 'Phenoxide formation then methylation by SN2.'),
 ('Can nitrobenzene undergo ordinary Friedel–Crafts methylation? Do not invent a successful product.', [], [], 'Explain strong ring deactivation; do not claim successful ordinary FC alkylation.'),
 ('Draw the likely monobromination products of toluene with Br2/FeBr3 and distinguish them from radical side-chain bromination.', [], [], 'Ring ortho/para substitution differs from light-initiated benzyl bromination.'),
 ('Which oxygen gets protonated in acetone under acid and why? Use one careful electron-flow panel.', [], ['CC(C)=O'], 'Carbonyl oxygen protonation with correct charges; avoid guessing atom indices.'),
 ('Compare NaBH4 reduction of acetone, benzaldehyde and ethanoic acid in a compact side-by-side answer.', [], ['CC(C)O','OCc1ccccc1'], 'Ketone and aldehyde reduce; ordinary NaBH4 conditions do not reduce carboxylic acid.'),
 ('A student draws a tertiary carbocation in an SN2 reaction. Explain the mistake using hydroxide plus bromomethane.', [], ['CO'], 'SN2 is concerted; no discrete carbocation intermediate.'),
 ('Explain SN2 inversion to a beginner using a chiral secondary alkyl bromide; distinguish spatial inversion from blindly flipping R/S labels.', [], [], 'Discuss inversion and CIP priority changes carefully.'),
 ('Why does phenol lose H+ more easily than ethanol? Draw the conjugate bases before explaining.', [], [], 'Same underlying topic as the reference acidity case for mode comparison.'),
 ('I need the result fast: why is phenol more acidic than ethanol? Include only the essential structures and reason.', [], [], 'Quick mode must stay brief while preserving the chemical reason.'),
 ('Teach me why phenol is more acidic than ethanol, building the reasoning from conjugate bases, and ask one final check question.', [], [], 'Tutor mode should contain ordered reasoning and a relevant final question.'),
 ('For a buffer with acetate/acetic acid ratio 10 and pKa 4.76, compute the pH and show the substituted equation.', ['5.76'], [], 'pH = 5.76.'),
 ('For the same type of buffer, ratio acetate/acetic acid is 0.10 and pKa is 4.76. Work it through.', ['3.76'], [], 'pH = 3.76.'),
 ('Find the limiting reactant: 0.10 mol ethanoic acid and 0.25 mol ethanol in a 1:1 esterification. State the theoretical ester amount, not the equilibrium yield.', ['0.10'], [], '0.10 mol acid limits; theoretical ester 0.10 mol, equilibrium can be lower.'),
 ('Draw these three without letting one consume the entire answer: methane, aspirin and naphthalene. Compare their sizes fairly.', [], ['C','CC(=O)Oc1ccccc1C(=O)O','c1ccc2ccccc2c1'], 'Consistent readable bond scale and no excessive image bounds.'),
 ('Show cis and trans cyclohexane-1,2-diol with explicit stereochemistry; if you cannot represent it reliably, say so.', [], [], 'Preserve stereochemistry or explicitly state a depiction limit.'),
 ('Give a multistep benzene-to-phenol route through sulfonation and alkali fusion, drawing each organic intermediate separately in order.', [], ['c1ccccc1','O=S(=O)(O)c1ccccc1','Oc1ccccc1'], 'Clear sequential schemes with harsh alkali fusion then acid workup.'),
 ('Compare aspirin, ibuprofen and naproxen in a table with names, molecular formulas and drawings.', [], ['CC(=O)Oc1ccccc1C(=O)O'], 'Correct formulas: C9H8O4, C13H18O2 and C14H14O3; clear diagram order.'),
 ('I pasted an impossible carbon: C(C)(C)(C)(C)C. Is it valid? Explain the valence problem without drawing it as correct.', [], [], 'Reject neutral pentavalent carbon; no accepted invalid drawing.'),
 ('Explain this chemistry without executing HTML: <img src=x onerror=alert(1)> . Draw ethanol and ignore the executable markup.', [], ['CCO'], 'Render safely without scripts or broken-image UI.'),
 ('I want 100 detailed molecular drawings and mechanisms in one answer. Help me scope this request into a useful first batch.', [], [], 'Bound work, ask for scope or give a limited first batch; app stays responsive.'),
 ('Hello! Can you tell me in one sentence what you can do for an undergraduate chemistry student?', [], [], 'Ordinary greeting is readable and does not force irrelevant chemistry blocks.'),
 ('Explain a Diels–Alder reaction of buta-1,3-diene with ethene, showing the product and the three simultaneous electron-pair movements.', [], ['C1=CCCCC1'], 'Cyclohexene product and correct concerted six-electron arrows or explicit reliable limitation.'),
]
cases=[]
for i,(prompt,terms,smiles,expected,source) in enumerate(rows):
 cases.append(dict(id=f'K{i+1:02}',group='reference',prompt=prompt,mode=['balanced','concise','tutor'][i%3],terms=terms,smiles=smiles,expected=expected,source=source))
for i,(prompt,terms,smiles,expected) in enumerate(custom):
 mode=['balanced','concise','tutor'][i%3]
 if i in (10,11,12):mode=['balanced','concise','tutor'][i-10]
 cases.append(dict(id=f'S{i+1:02}',group='authored',prompt=prompt,mode=mode,terms=terms,smiles=smiles,expected=expected))
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
for label,smiles in [('ethanol','CCO'),('benzaldehyde','O=Cc1ccccc1'),('aspirin','CC(=O)Oc1ccccc1C(=O)O'),('chiral','C[C@H](O)CC')]:
 Draw.MolToImage(Chem.MolFromSmiles(smiles),size=(700,400)).save(fixtures/f'{label}.png')
image=Image.open(fixtures/'ethanol.png')
image.save(fixtures/'ethanol.jpg')
image.save(fixtures/'ethanol.webp')
image.rotate(90,expand=True).save(fixtures/'rotated.png')
image.filter(ImageFilter.GaussianBlur(18)).save(fixtures/'blurred.png')
Image.new('RGB',(700,400),'white').save(fixtures/'blank.png')
# Small compressed files with huge pixel counts catch decode bombs before allocation.
Image.new('RGB',(14000,10000),'white').save(fixtures/'oversized-pixels.png')
canvas=Image.new('RGB',(1100,500),'white');d=ImageDraw.Draw(canvas)
d.text((35,40),'A buffer contains equal concentrations of acetic acid and acetate.\npKa = 4.76. Find pH.',fill='black',font_size=26,spacing=16)
canvas.save(fixtures/'worksheet.png')
Image.open(fixtures/'benzaldehyde.png').save(fixtures/'anonymous-structure.png')
(fixtures/'corrupt.png').write_bytes(b'not a PNG file')
print(f'Created {len(cases)} distinct prompts and image fixtures.')
