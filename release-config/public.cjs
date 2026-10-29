const base=require('../package.json').build;
module.exports={...base,forceCodeSigning:true,dmg:{...base.dmg,sign:true},mac:{...base.mac,notarize:true}};
