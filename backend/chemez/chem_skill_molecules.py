"""Common molecules with PubChem isomeric SMILES.

Vendored data from ghutchis/chem-skill (MIT, Copyright (c) 2025 Geoff Hutchison),
scripts/common_molecules.py at commit bdb58112cd010cbf6a68a244ed904f4dfb90496f.
Only the MOLECULES and ALIASES tables are kept; see THIRD_PARTY_NOTICES.md.
"""
MOLECULES = {
    # =========================================================================
    # SIMPLE MOLECULES (no stereocenters)
    # =========================================================================
    "water": "O",
    "ethanol": "CCO",
    "methanol": "CO",
    "acetone": "CC(=O)C",
    "acetic_acid": "CC(=O)O",
    "ammonia": "N",
    "carbon_dioxide": "C(=O)=O",
    "methane": "C",
    "ethane": "CC",
    "propane": "CCC",
    "butane": "CCCC",
    "benzene": "C1=CC=CC=C1",
    "toluene": "CC1=CC=CC=C1",
    "phenol": "C1=CC=C(C=C1)O",
    "formaldehyde": "C=O",
    "formic_acid": "C(=O)O",
    "urea": "C(=O)(N)N",

    # =========================================================================
    # SUGARS & CARBOHYDRATES (with stereochemistry)
    # =========================================================================
    "glucose": "C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O",  # D-glucose
    "fructose": "C1[C@H]([C@H]([C@@H](C(O1)(CO)O)O)O)O",  # D-fructose
    "sucrose": "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O",

    # =========================================================================
    # PAIN RELIEVERS / NSAIDs
    # =========================================================================
    "aspirin": "CC(=O)OC1=CC=CC=C1C(=O)O",
    "ibuprofen": "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O",
    "acetaminophen": "CC(=O)NC1=CC=C(C=C1)O",
    "naproxen": "C[C@@H](C1=CC2=C(C=C1)C=C(C=C2)OC)C(=O)O",  # (S)-naproxen

    # =========================================================================
    # STIMULANTS
    # =========================================================================
    "caffeine": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    "nicotine": "CN1CCC[C@H]1C2=CN=CC=C2",  # (S)-nicotine
    "amphetamine": "CC(CC1=CC=CC=C1)N",
    "cocaine": "CN1[C@H]2CC[C@@H]1[C@H]([C@H](C2)OC(=O)C3=CC=CC=C3)C(=O)OC",

    # =========================================================================
    # NEUROTRANSMITTERS
    # =========================================================================
    "dopamine": "C1=CC(=C(C=C1CCN)O)O",
    "serotonin": "C1=CC2=C(C=C1O)C(=CN2)CCN",
    "epinephrine": "CNC[C@@H](C1=CC(=C(C=C1)O)O)O",
    "norepinephrine": "C1=CC(=C(C=C1[C@H](CN)O)O)O",
    "acetylcholine": "CC(=O)OCC[N+](C)(C)C",
    "histamine": "C1=C(NC=N1)CCN",
    "gaba": "C(CC(=O)O)CN",
    "glutamate": "C(CC(=O)O)[C@@H](C(=O)O)N",

    # =========================================================================
    # HORMONES
    # =========================================================================
    "melatonin": "CC(=O)NCCC1=CNC2=C1C=C(C=C2)OC",
    "testosterone": "C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CCC4=CC(=O)CC[C@]34C",
    "estradiol": "C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CCC4=C3C=CC(=C4)O",
    "progesterone": "CC(=O)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CCC4=CC(=O)CC[C@]34C)C",
    "cortisol": "C[C@]12CCC(=O)C=C1CC[C@@H]3[C@@H]2[C@H](C[C@]4([C@H]3CC[C@@]4(C(=O)CO)O)C)O",
    "thyroxine": "C1=C(C=C(C(=C1I)OC2=CC(=C(C(=C2)I)O)I)I)C[C@@H](C(=O)O)N",

    # =========================================================================
    # STEROIDS & LIPIDS
    # =========================================================================
    "cholesterol": "C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C",

    # =========================================================================
    # CANNABINOIDS
    # =========================================================================
    "thc": "CCCCCC1=CC(=C2[C@@H]3C=C(CC[C@H]3C(OC2=C1)(C)C)C)O",
    "cbd": "CCCCCC1=CC(=C(C(=C1)O)[C@@H]2C=C(CC[C@H]2C(=C)C)C)O",

    # =========================================================================
    # OPIOIDS
    # =========================================================================
    "morphine": "CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O",
    "codeine": "CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)OC)O[C@H]3[C@H](C=C4)O",
    "fentanyl": "CCC(=O)N(C1CCN(CC1)CCC2=CC=CC=C2)C3=CC=CC=C3",
    "heroin": "CC(=O)O[C@H]1C=C[C@H]2[C@H]3CC4=C5[C@]2([C@H]1OC5=C(C=C4)OC(=O)C)CCN3C",

    # =========================================================================
    # AMINO ACIDS (L-form with correct stereochemistry)
    # =========================================================================
    "glycine": "C(C(=O)O)N",  # no stereocenter
    "alanine": "C[C@@H](C(=O)O)N",
    "valine": "CC(C)[C@@H](C(=O)O)N",
    "leucine": "CC(C)C[C@@H](C(=O)O)N",
    "isoleucine": "CC[C@H](C)[C@@H](C(=O)O)N",
    "proline": "C1C[C@H](NC1)C(=O)O",
    "phenylalanine": "C1=CC=C(C=C1)C[C@@H](C(=O)O)N",
    "tyrosine": "C1=CC(=CC=C1C[C@@H](C(=O)O)N)O",
    "tryptophan": "C1=CC=C2C(=C1)C(=CN2)C[C@@H](C(=O)O)N",
    "serine": "C([C@@H](C(=O)O)N)O",
    "threonine": "C[C@H]([C@@H](C(=O)O)N)O",
    "cysteine": "C([C@@H](C(=O)O)N)S",
    "methionine": "CSCC[C@@H](C(=O)O)N",
    "asparagine": "C([C@@H](C(=O)O)N)C(=O)N",
    "glutamine": "C(CC(=O)N)[C@@H](C(=O)O)N",
    "lysine": "C(CCN)C[C@@H](C(=O)O)N",
    "arginine": "C(C[C@@H](C(=O)O)N)CN=C(N)N",
    "histidine": "C1=C(NC=N1)C[C@@H](C(=O)O)N",
    "aspartic_acid": "C([C@@H](C(=O)O)N)C(=O)O",
    "glutamic_acid": "C(CC(=O)O)[C@@H](C(=O)O)N",

    # =========================================================================
    # NUCLEOBASES
    # =========================================================================
    "adenine": "C1=NC2=NC=NC(=C2N1)N",
    "guanine": "C1=NC2=C(N1)C(=O)NC(=N2)N",
    "cytosine": "C1=C(NC(=O)N=C1)N",
    "thymine": "CC1=CNC(=O)NC1=O",
    "uracil": "C1=CNC(=O)NC1=O",

    # =========================================================================
    # VITAMINS & ORGANIC ACIDS
    # =========================================================================
    "ascorbic_acid": "C([C@@H]([C@@H]1C(=C(C(=O)O1)O)O)O)O",  # L-ascorbic acid (vitamin C)
    "citric_acid": "C(C(=O)O)C(CC(=O)O)(C(=O)O)O",
    "lactic_acid": "C[C@@H](C(=O)O)O",  # L-lactic acid
    "oxalic_acid": "C(=O)(C(=O)O)O",
    "tartaric_acid": "[C@@H]([C@H](C(=O)O)O)(C(=O)O)O",  # (R,R)-tartaric acid (natural form)
    "malic_acid": "C([C@@H](C(=O)O)O)C(=O)O",  # L-malic acid
    "succinic_acid": "C(CC(=O)O)C(=O)O",
    "fumaric_acid": "C(=C/C(=O)O)\\C(=O)O",  # trans double bond

    # =========================================================================
    # COMMON DRUGS
    # =========================================================================
    "lidocaine": "CCN(CC)CC(=O)NC1=C(C=CC=C1C)C",
    "atropine": "CN1[C@@H]2CC[C@H]1CC(C2)OC(=O)C(CO)C3=CC=CC=C3",
    "diphenhydramine": "CN(C)CCOC(C1=CC=CC=C1)C2=CC=CC=C2",
    "loratadine": "CCOC(=O)N1CCC(=C2C3=C(CCC4=C2N=CC=C4)C=C(C=C3)Cl)CC1",
    "omeprazole": "CC1=CN=C(C(=C1OC)C)CS(=O)C2=NC3=C(N2)C=C(C=C3)OC",
    "metformin": "CN(C)C(=N)N=C(N)N",
    "atorvastatin": "CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4",
    "sildenafil": "CCCC1=NN(C2=C1N=C(NC2=O)C3=C(C=CC(=C3)S(=O)(=O)N4CCN(CC4)C)OCC)C",
    "warfarin": "CC(=O)CC(C1=CC=CC=C1)C2=C(C3=CC=CC=C3OC2=O)O",
    "penicillin_g": "CC1([C@@H](N2[C@H](S1)[C@@H](C2=O)NC(=O)CC3=CC=CC=C3)C(=O)O)C",
    "amoxicillin": "CC1([C@@H](N2[C@H](S1)[C@@H](C2=O)NC(=O)[C@@H](C3=CC=C(C=C3)O)N)C(=O)O)C",

    # =========================================================================
    # PSYCHEDELICS
    # =========================================================================
    "lsd": "CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C",
    "psilocybin": "CN(C)CCC1=CNC2=C1C(=CC=C2)OP(=O)(O)O",
    "mescaline": "COC1=CC(=CC(=C1OC)OC)CCN",
    "dmt": "CN(C)CCC1=CNC2=CC=CC=C21",

    # =========================================================================
    # SOLVENTS
    # =========================================================================
    "isopropanol": "CC(C)O",
    "dmso": "CS(=O)C",
    "dmf": "CN(C)C=O",
    "thf": "C1CCOC1",
    "acetonitrile": "CC#N",
    "chloroform": "C(Cl)(Cl)Cl",
    "dichloromethane": "C(Cl)Cl",
    "diethyl_ether": "CCOCC",
    "hexane": "CCCCCC",
    "cyclohexane": "C1CCCCC1",
    "pyridine": "C1=CC=NC=C1",
    "glycerol": "C(C(CO)O)O",
    "ethylene_glycol": "C(CO)O",
    "propylene_glycol": "CC(CO)O",
    "ethyl_acetate": "CCOC(=O)C",
    "butanol": "CCCCO",

    # =========================================================================
    # OTHER BIOACTIVE MOLECULES
    # =========================================================================
    "ephedrine": "C[C@@H]([C@@H](C1=CC=CC=C1)O)NC",
    "pseudoephedrine": "C[C@@H]([C@H](C1=CC=CC=C1)O)NC",
    "oxytocin": "CC[C@H](C)[C@H]1C(=O)N[C@H](C(=O)N[C@H](C(=O)N[C@@H](CSSC[C@@H](C(=O)N[C@H](C(=O)N1)CC2=CC=C(C=C2)O)N)C(=O)N3CCC[C@H]3C(=O)N[C@@H](CC(C)C)C(=O)NCC(=O)N)CC(=O)N)CCC(=O)N",
}

# Common aliases for molecule lookup
ALIASES = {
    # Drug brand names and common names
    "tylenol": "acetaminophen",
    "paracetamol": "acetaminophen",
    "advil": "ibuprofen",
    "motrin": "ibuprofen",
    "aleve": "naproxen",
    "viagra": "sildenafil",
    "lipitor": "atorvastatin",
    "coumadin": "warfarin",
    "prilosec": "omeprazole",
    "glucophage": "metformin",
    "benadryl": "diphenhydramine",
    "claritin": "loratadine",
    "xylocaine": "lidocaine",

    # Chemical synonyms
    "adrenaline": "epinephrine",
    "noradrenaline": "norepinephrine",
    "5-ht": "serotonin",
    "5-hydroxytryptamine": "serotonin",
    "vitamin_c": "ascorbic_acid",
    "alcohol": "ethanol",
    "wood_alcohol": "methanol",
    "rubbing_alcohol": "isopropanol",
    "table_sugar": "sucrose",
    "dextrose": "glucose",
    "fruit_sugar": "fructose",
    "cannabidiol": "cbd",
    "tetrahydrocannabinol": "thc",
    "delta-9-thc": "thc",
    "dimethyltryptamine": "dmt",
    "n,n-dimethyltryptamine": "dmt",
    "lysergic_acid_diethylamide": "lsd",
    "acid": "lsd",

    # Alternate spellings
    "diamorphine": "heroin",
    "diacetylmorphine": "heroin",

    # Amino acid abbreviations
    "gly": "glycine",
    "ala": "alanine",
    "val": "valine",
    "leu": "leucine",
    "ile": "isoleucine",
    "pro": "proline",
    "phe": "phenylalanine",
    "tyr": "tyrosine",
    "trp": "tryptophan",
    "ser": "serine",
    "thr": "threonine",
    "cys": "cysteine",
    "met": "methionine",
    "asn": "asparagine",
    "gln": "glutamine",
    "lys": "lysine",
    "arg": "arginine",
    "his": "histidine",
    "asp": "aspartic_acid",
    "glu": "glutamic_acid",

    # Nucleobase synonyms
    "a": "adenine",
    "g": "guanine",
    "c": "cytosine",
    "t": "thymine",
    "u": "uracil",
}
