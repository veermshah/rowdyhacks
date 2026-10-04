// Original ink illustration; CSS loops animate only the rain and car layers.
export default function NoirCity(){
  return <svg viewBox="0 0 640 740" role="img" aria-label="An ink-drawn getaway car in a rain-dark San Antonio street, beneath the Tower of the Americas" preserveAspectRatio="xMidYMid slice">
    <defs>
      <pattern id="ink-rain" width="57" height="87" patternUnits="userSpaceOnUse"><path d="M5 -20 26 33M36 28 59 83M7 59 18 86" stroke="#aab6b5" strokeWidth="1" opacity=".27"/></pattern>
      <pattern id="ink-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(25)"><path d="M0 0V7" stroke="#090e12" strokeWidth="2"/></pattern>
      <pattern id="ink-windows" width="35" height="47" patternUnits="userSpaceOnUse"><path d="M8 9h15v26H8z" fill="#778084" stroke="#141c22" strokeWidth="3"/><path d="M15 10v24M8 22h15" stroke="#192128" strokeWidth="2"/></pattern>
    </defs>
    <path fill="#596874" d="M0 0h640v740H0z"/>
    <circle cx="435" cy="113" r="59" fill="#c6c6ad"/>
    <path d="m354 82 123 5 45 13-139 8-56-9zM412 139l87-6 34 14-137 10z" fill="#596874"/>
    <path d="M128 443V184h63v57h31V111h73v176h47V173h69v89h63v179z" fill="#343f4b" stroke="#182128" strokeWidth="3"/>
    <path d="M345 413V176h8v237M322 157h55l-6 17h-43zM328 148h44v10h-44zM347 146V96" fill="#a0a4a0" stroke="#151e25" strokeWidth="3"/>
    <path d="M0 0h134l73 412L0 633z" fill="#1b242c" stroke="#080e13" strokeWidth="6"/>
    <path d="m134 0 73 412-26 23L108 0z" fill="#65717a" stroke="#0b1217" strokeWidth="3"/>
    <path d="M0 41h99l59 326L0 481z" fill="url(#ink-windows)"/>
    <path d="m0 144 122-19m-122 157 145-38M0 407l166-70" stroke="#090f15" strokeWidth="13"/>
    <path d="m640 64-106 38-79 326 185 186z" fill="#849094" stroke="#0a1117" strokeWidth="6"/>
    <path d="m640 137-85 27-59 252 144 114z" fill="url(#ink-windows)"/>
    <path d="m529 120-62 305-35-8 57-267z" fill="#333f49" stroke="#10181f" strokeWidth="4"/>
    <path d="m640 258-122-1m122 138-151-79m151 215-172-152" stroke="#151e25" strokeWidth="9"/>
    <path d="m214 405 213 0 213 335H0z" fill="#36454e" stroke="#0a1218" strokeWidth="4"/>
    <path d="M214 405 0 654v86l246-331M427 405l213 249v86L399 407" fill="#727b7d" stroke="#0d151b" strokeWidth="3"/>
    <path d="m284 456 17-35h7l-11 35zm-49 114 31-68h19l-23 68zm-68 170 44-112h27l-29 112z" fill="#afa997" opacity=".65"/>
    <path d="m0 708 238-129m402 125-203-143M13 622l107 8M554 613l86 12" stroke="#121b23" strokeWidth="3"/>
    <path d="M172 461V258q0-19-29-19h-18M492 463V300q0-17 23-17h14" fill="none" stroke="#0b1116" strokeWidth="7"/>
    <path d="m113 233 28-1-3 31-20 0zM519 277h24l-4 26h-16z" fill="#d7c8a1" stroke="#10171d" strokeWidth="4"/>
    <path d="m166 446 13 0 11 25h-38zM487 451h10l13 25h-32z" fill="#111a21"/>
    <g className="noir-car-drift"><g className="noir-car-bounce">
    <path d="m311 492-69 112 52-1 45-111M437 494l35 109h64l-80-111" fill="#c6b99a" opacity=".13"/>
    <ellipse cx="376" cy="544" rx="125" ry="26" fill="#0a1117"/>
    <path d="m266 471 29-70 114-13 60 75 18 45-13 26-204 7-23-21z" fill="#677a7c" stroke="#090f14" strokeWidth="6"/>
    <path d="m304 410 96-11 45 56-163 13z" fill="#111d27" stroke="#a2abaa" strokeWidth="3"/>
    <path d="m319 411-18 53m90-61 24 58m-108-25 93-14" stroke="#66767c" strokeWidth="3"/>
    <path d="m274 479 188-12 13 36-220 10z" fill="#84918f" stroke="#131d24" strokeWidth="3"/>
    <path d="m276 520 179-8m-163 16 147-9" stroke="#151f27" strokeWidth="7"/>
    <path d="m257 497 39-3 1 13-44 3zm174-11 36-2 9 13-44 3z" fill="#d6c8a4" stroke="#101820" strokeWidth="3"/>
    <path d="m267 534 32-2v21h-27zm163-7 40-2-4 20h-33z" fill="#080f14"/>
    <path d="m343 523 40-2v10h-40z" fill="#bbb9a7"/>
    </g></g>
    <path d="m0 0 56 0 112 377L0 481zM580 113l60-18v361l-107-81zM0 740l73-80 74 80z" fill="url(#ink-hatch)" opacity=".5"/>
    <path className="noir-rain-fall" fill="url(#ink-rain)" d="M-114 -174h868v1088H-114z"/>
    <path d="m72 531 22-12 18 4-18 13zm491 78 25-9-13 20-22 4z" fill="#ac7067" stroke="#10171d" strokeWidth="2"/>
  </svg>;
}
