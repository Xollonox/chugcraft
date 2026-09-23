export function nightLighting(dayFactor, visibility=.75, rain=0) {
 const v=Math.min(1,Math.max(0,Number.isFinite(visibility)?visibility:.75));
 const night=1-Math.min(1,Math.max(0,dayFactor));
 return {boost:night*.54*v*(1-rain*.2),ambient:.045+night*.12*v,gamma:night*.45*v};
}
