import pytest
from chemez.local_tools import answer,balance,convert,formula_info


def test_balancing_conserves_atoms():
    assert balance('Fe + O2 -> Fe2O3')=='4 Fe + 3 O2 → 2 Fe2O3'
    assert balance('C2H6 + O2 -> CO2 + H2O')=='2 C2H6 + 7 O2 → 4 CO2 + 6 H2O'
    assert balance('Ca(OH)2 + HCl -> CaCl2 + H2O')=='Ca(OH)2 + 2 HCl → CaCl2 + 2 H2O'


def test_invalid_or_ambiguous_balance_is_not_guessed():
    for value in ('H2 -> CO2','C + O2 -> CO + CO2','H2 + O2 -> H2 + O2'):
        with pytest.raises(ValueError):balance(value)


def test_unit_conversion_and_incompatible_dimensions():
    assert convert(250,'mg','g')==pytest.approx(.25)
    assert convert(25,'degC','kelvin')==pytest.approx(298.15)
    with pytest.raises(Exception):convert(3,'meter','second')
    with pytest.raises(ValueError):convert(3,'m**999','m')


def test_formula_and_bounds():
    assert formula_info('Ca(OH)2')['composition']=={'Ca':1,'H':2,'O':2}
    assert formula_info('H2O')['mass']==pytest.approx(18.015,abs=.002)
    with pytest.raises(ValueError):formula_info('C999999999')


def test_only_explicit_calculations_are_intercepted():
    assert answer('hello') is None
    assert answer('Explain why ethanol is polar') is None
    assert '0.25 g' in answer('convert 250 mg to g')
    assert '4 Fe' in answer('balance Fe + O2 -> Fe2O3')
    assert 'g/mol' in answer('molar mass of NaOH')


def test_offline_element_reference():
    result=answer('atomic properties of oxygen')
    assert 'Oxygen (O)' in result and '| Atomic number | 8 |' in result


def test_calculated_chlorine_isotope_envelope():
    from chemez.local_tools import isotope_table
    table=isotope_table('Cl2')
    assert '100.00' in table and '63.99' in table and '10.24' in table
    assert 'fragmentation' in table and 'z = +1' in table
    assert isotope_table('C201H404') is None
