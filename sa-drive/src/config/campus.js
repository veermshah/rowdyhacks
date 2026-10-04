import { toLocal } from './worldConfig.js';
// San Pedro II, 622 Dolorosa Street. Center from the OSM campus footprint.
export const SP2 = { lat:29.4238688125, lon:-98.496916925 };
export const SP2_POINT = toLocal(SP2.lat,SP2.lon);
export const CAMPUS_BUILDINGS = {
  1414156000:{name:'SP2',subtitle:'SAN PEDRO II',height:31,color:'#c5aa88'},
  366390704:{name:'SP1',subtitle:'SAN PEDRO I',height:25,color:'#beab8b'},
  80475798:{name:'UTSA',subtitle:'DOWNTOWN CAMPUS',height:19,color:'#cbb597'},
  80475799:{name:'UTSA',subtitle:'DURANGO BUILDING',height:18,color:'#cbb597'},
  126457328:{name:'UTSA',subtitle:'FRIO STREET',height:19,color:'#cbb597'},
};
