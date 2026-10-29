"""Independent, bounded electron-pair graph accounting.

Bond-change vocabulary follows RMG's public ReactionRecipe interface; this is
an RDKit implementation, not the RMG kinetic generator or a pathway predictor.
"""
from rdkit import Chem


def verify_pair_step(mol, following, arrows):
    """Apply the arrows by electron counting and check they give the next panel.

    Every arrow moves its electrons (2 for a full arrow, 1 for a fishhook) from a lone pair
    or radical on an atom, or from a bond, to an atom or to a bond (existing, or new between
    two atoms). Bond order is bond electrons / 2; formal charge = valence electrons −
    nonbonding electrons − bonds; an odd nonbonding count is a radical.
    """
    if not arrows:
        raise ValueError('Supply electron-flow arrows for this transition.')
    source=Chem.Mol(mol)
    if any(a.GetIsAromatic() for a in source.GetAtoms()):
        Chem.Kekulize(source,clearAromaticFlags=True)
    table=Chem.GetPeriodicTable()
    original={tuple(sorted((b.GetBeginAtomIdx(),b.GetEndAtomIdx()))):int(b.GetBondTypeAsDouble()) for b in source.GetBonds()}
    shared={bond:2*order for bond,order in original.items()}
    hydrogens=[a.GetTotalNumHs() for a in source.GetAtoms()]
    lone=[table.GetNOuterElecs(a.GetAtomicNum())-a.GetTotalValence()-a.GetFormalCharge() for a in source.GetAtoms()]
    for arrow in arrows:
        moved=arrow.electrons
        for anchor in (arrow.tail,arrow.head):
            if len(set(anchor))!=len(anchor) or any(i<0 or i>=source.GetNumAtoms() for i in anchor):
                raise ValueError('Electron-flow anchor is outside the structure or repeated.')
        if len(arrow.tail)==2:
            bond=tuple(sorted(arrow.tail))
            if bond not in original:raise ValueError('The electron source must be an existing bond (an arrow cannot start between two unbonded atoms).')
            shared[bond]=shared.get(bond,0)-moved
            if shared[bond]<0:raise ValueError('More electrons leave this bond than it holds.')
        else:
            donor=arrow.tail[0]
            lone[donor]-=moved
            if lone[donor]<0:
                raise ValueError('The proposed donor does not have the required lone electron pair.' if moved==2 else 'The proposed atom has no unpaired electron to move.')
        if len(arrow.head)==2:
            bond=tuple(sorted(arrow.head))
            if len(arrow.tail)==2 and not set(bond)&set(arrow.tail):
                raise ValueError('Electrons from a bond can only move to a bond that shares one of its atoms.')
            shared[bond]=shared.get(bond,0)+moved
        elif len(arrow.tail)==1 and arrow.head!=arrow.tail:
            # Atom → atom is shorthand for donating electrons into a new bond.
            bond=tuple(sorted((arrow.tail[0],arrow.head[0])))
            shared[bond]=shared.get(bond,0)+moved
        elif len(arrow.tail)==1:
            raise ValueError('An atom cannot donate electrons to itself.')
        else:
            if arrow.head[0] not in arrow.tail:
                raise ValueError('Electrons from a bond can only move onto one of its own atoms.')
            lone[arrow.head[0]]+=moved
    predicted=Chem.RWMol(source)
    actions=[]
    for bond in sorted(set(original)|set(shared)):
        electrons=shared.get(bond,0)
        if electrons%2:
            raise ValueError('These arrows leave a bond with an odd number of electrons. Pair each fishhook with a second one (homolysis or radical coupling).')
        before,after=original.get(bond,0),electrons//2
        if after not in (0,1,2,3):raise ValueError('Electron flow creates an invalid bond order.')
        if before==after:continue
        if before:predicted.RemoveBond(*bond)
        if after:predicted.AddBond(*bond,{1:Chem.BondType.SINGLE,2:Chem.BondType.DOUBLE,3:Chem.BondType.TRIPLE}[after])
        kind='FORM_BOND' if not before else 'BREAK_BOND' if not after else 'CHANGE_BOND'
        a,b=(source.GetAtomWithIdx(i).GetSymbol() for i in bond)
        actions.append({'action':kind,'atoms':list(bond),'before':before,'after':after,'label':f'{a}–{b}'})
    for atom in predicted.GetAtoms():
        i=atom.GetIdx()
        bonded=hydrogens[i]+sum(e//2 for bond,e in shared.items() if i in bond)
        atom.SetNumExplicitHs(hydrogens[i])
        atom.SetNoImplicit(True)
        atom.SetFormalCharge(table.GetNOuterElecs(atom.GetAtomicNum())-lone[i]-bonded)
        atom.SetNumRadicalElectrons(lone[i]%2)
    def identity(value):
        value=Chem.Mol(value)
        for atom in value.GetAtoms():atom.SetAtomMapNum(0)
        Chem.SanitizeMol(value)
        return Chem.MolToSmiles(Chem.RemoveHs(value),isomericSmiles=True)
    if identity(predicted.GetMol())!=identity(following):
        raise ValueError('These electron-flow arrows do not produce the next panel. Correct the bond changes, charges and participating species together.')
    return actions
