(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.VortexL2 = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/*
 * progress_bar.js
 * DOM-optional: the Level 2 parser calls these while decoding, and that parser
 * is also bundled standalone for pages that have no progress bar (the Graphics
 * Studio). Every lookup is therefore guarded — a missing element is a no-op,
 * not a TypeError that aborts the decode.
 */
function set_progress_bar_width(width_percent) {
    if (width_percent >= 100) { width_percent = 100 }
    const elem = document.getElementById('mainProgressBarInner');
    if (!elem) return;
    elem.style.right = '4px';
    const width = elem.offsetWidth;
    elem.style.right = `${width - ((width * (width_percent / 100)) - 4)}px`;
}

function set_progress_bar_text(text) {
    const elem = document.getElementById('mainProgressBarText');
    if (!elem) return;
    elem.innerHTML = text;
}

function show_progress_bar() {
    if (typeof $ === 'undefined') return;
    $('#progress_bar_screen_background').show();
}

function hide_progress_bar() {
    if (typeof $ === 'undefined') return;
    $('#progress_bar_screen_background').hide();
}

module.exports = {
    set_progress_bar_width,
    set_progress_bar_text,
    show_progress_bar,
    hide_progress_bar
}
},{}],2:[function(require,module,exports){
const colortable_parser = require('./colortable_parser');

const range_folded = 'rgb(139, 0, 218)';
const range_folded_val = 999;

// Default base reflectivity — "Generated Color Table with Tools by Garrett Helms
// for WxTools.org" (installed as the Vortex Radar default 2026-08-21).
const reflectivity =
`Product: BR
Units: dBZ
Step: 5

SolidColor4: 9.9 193 193 193 0
SolidColor: 25 128 252 131
SolidColor: 30 1 63 0
SolidColor: 35 251 249 10
SolidColor: 40 247 128 1
SolidColor: 45 249 6 0
SolidColor: 50 128 0 4
SolidColor: 55 248 8 245
SolidColor: 60 255 81 248
SolidColor: 65 255 255 255
SolidColor: 70 255 255 255`
const reflectivity_radarscope = 
`Product: BR
Units:   DBZ
Step:    5
SolidColor:	-32.0		115	77	172
SolidColor:	-31.5		115	78	168
SolidColor:	-31.0		115	79	165
SolidColor:	-30.5		115	81	162
SolidColor:	-30.0		116	82	158
SolidColor:	-29.5		116	84	155
SolidColor:	-29.0		116	85	152
SolidColor:	-28.5		117	86	148
SolidColor:	-28.0		117	88	145
SolidColor:	-27.5		117	89	142
SolidColor:	-27.0		118	91	138
SolidColor:	-26.5		118	92	135
SolidColor:	-26.0		118	94	132
SolidColor:	-25.5		119	95	128
SolidColor:	-25.0		119	96	125
SolidColor:	-24.5		119	98	122
SolidColor:	-24.0		120	99	118
SolidColor:	-23.5		120	101	115
SolidColor:	-23.0		120	102	112
SolidColor:	-22.5		121	103	108
SolidColor:	-22.0		121	105	105
SolidColor:	-21.5		121	106	102
SolidColor:	-21.0		122	108	98
SolidColor:	-20.5		122	109	95
SolidColor:	-20.0		122	111	92
SolidColor:	-19.5		123	112	88
SolidColor:	-19.0		123	113	85
SolidColor:	-18.5		123	115	82
SolidColor:	-18.0		124	116	78
SolidColor:	-17.5		124	118	75
SolidColor:	-17.0		124	119	72
SolidColor:	-16.5		125	121	69
SolidColor:	-16.0		127	123	72
SolidColor:	-15.5		129	125	75
SolidColor:	-15.0		131	127	79
SolidColor:	-14.5		133	130	82
SolidColor:	-14.0		135	132	85
SolidColor:	-13.5		137	134	89
SolidColor:	-13.0		139	137	92
SolidColor:	-12.5		141	139	96
SolidColor:	-12.0		144	141	99
SolidColor:	-11.5		146	144	102
SolidColor:	-11.0		148	146	106
SolidColor:	-10.5		150	148	109
SolidColor:	-10.0		152	151	113
SolidColor:	-9.5		154	153	116
SolidColor:	-9.0		156	155	119
SolidColor:	-8.5		158	158	123
SolidColor:	-8.0		161	160	126
SolidColor:	-7.5		163	162	130
SolidColor:	-7.0		165	165	133
SolidColor:	-6.5		167	167	136
SolidColor:	-6.0		169	169	140
SolidColor:	-5.5		171	172	143
SolidColor:	-5.0		173	174	147
SolidColor:	-4.5		175	176	150
SolidColor:	-4.0		178	179	154
SolidColor:	-3.5		173	175	153
SolidColor:	-3.0		168	171	152
SolidColor:	-2.5		163	167	151
SolidColor:	-2.0		158	163	150
SolidColor:	-1.5		154	159	149
SolidColor:	-1.0		149	155	148
SolidColor:	-0.5		144	151	147
SolidColor:	 0.0		139	147	146
SolidColor:	 0.5		135	144	145
SolidColor:	 1.0		130	140	144
SolidColor:	 1.5		125	136	143
SolidColor:	 2.0		120	132	142
SolidColor:	 2.5		115	128	142
SolidColor:	 3.0		111	124	141
SolidColor:	 3.5		106	120	140
SolidColor:	 4.0		101	116	139
SolidColor:	 4.5		96	112	138
SolidColor:	 5.0		92	109	137
SolidColor:	 5.5		87	105	136
SolidColor:	 6.0		82	101	135
SolidColor:	 6.5		77	97	134
SolidColor:	 7.0		73	93	133
SolidColor:	 7.5		68	89	132
SolidColor:	 8.0		63	85	131
SolidColor:	 8.5		58	81	130
SolidColor:	 9.0		54	78	130
SolidColor:	 9.5		55	81	132
SolidColor:	10.0		57	85	134
SolidColor:	10.5		59	89	136
SolidColor:	11.0		61	93	138
SolidColor:	11.5		63	97	141
SolidColor:	12.0		65	101	143
SolidColor:	12.5		67	105	145
SolidColor:	13.0		69	109	147
SolidColor:	13.5		71	113	149
SolidColor:	14.0		73	117	152
SolidColor:	14.5		74	121	154
SolidColor:	15.0		76	125	156
SolidColor:	15.5		78	129	158
SolidColor:	16.0		80	133	160
SolidColor:	16.5		82	137	163
SolidColor:	17.0		84	141	165
SolidColor:	17.5		86	145	167
SolidColor:	18.0		88	149	169
SolidColor:	18.5		90	153	171
SolidColor:	19.0		92	157	174
SolidColor:	19.5		76	165	142
SolidColor:	20.0		60	173	110
SolidColor:	20.5		45	182	78
SolidColor:	21.0		42	175	72
SolidColor:	21.5		39	169	67
SolidColor:	22.0		37	163	62
SolidColor:	22.5		34	156	56
SolidColor:	23.0		31	150	51
SolidColor:	23.5		29	144	46
SolidColor:	24.0		26	137	40
SolidColor:	24.5		24	131	35
SolidColor:	25.0		21	125	30
SolidColor:	25.5		18	118	24
SolidColor:	26.0		16	112	19
SolidColor:	26.5		13	106	14
SolidColor:	27.0		11	100	9
SolidColor:	27.5		35	115	8
SolidColor:	28.0		59	130	7
SolidColor:	28.5		83	145	6
SolidColor:	29.0		107	161	5
SolidColor:	29.5		131	176	4
SolidColor:	30.0		155	191	3
SolidColor:	30.5		179	207	2
SolidColor:	31.0		203	222	1
SolidColor:	31.5		227	237	0
SolidColor:	32.0		252	253	0
SolidColor:	32.5		248	248	0
SolidColor:	33.0		244	243	0
SolidColor:	33.5		241	238	0
SolidColor:	34.0		237	233	0
SolidColor:	34.5		233	228	0
SolidColor:	35.0		230	223	0
SolidColor:	35.5		226	218	0
SolidColor:	36.0		222	213	0
SolidColor:	36.5		219	208	0
SolidColor:	37.0		215	203	0
SolidColor:	37.5		211	198	0
SolidColor:	38.0		208	193	0
SolidColor:	38.5		204	188	0
SolidColor:	39.0		200	183	0
SolidColor:	39.5		197	179	0
SolidColor:	40.0		250	148	0
SolidColor:	40.5		246	144	0
SolidColor:	41.0		242	141	1
SolidColor:	41.5		238	138	1
SolidColor:	42.0		234	135	2
SolidColor:	42.5		231	132	3
SolidColor:	43.0		227	129	3
SolidColor:	43.5		223	126	4
SolidColor:	44.0		219	123	5
SolidColor:	44.5		215	120	5
SolidColor:	45.0		212	116	6
SolidColor:	45.5		208	113	6
SolidColor:	46.0		204	110	7
SolidColor:	46.5		200	107	8
SolidColor:	47.0		196	104	8
SolidColor:	47.5		193	101	9
SolidColor:	48.0		189	98	10
SolidColor:	48.5		185	95	10
SolidColor:	49.0		181	92	11
SolidColor:	49.5		178	89	12
SolidColor:	50.0		249	35	11
SolidColor:	50.5		242	35	12
SolidColor:	51.0		236	35	13
SolidColor:	51.5		230	35	14
SolidColor:	52.0		223	36	15
SolidColor:	52.5		217	36	16
SolidColor:	53.0		211	36	17
SolidColor:	53.5		205	36	18
SolidColor:	54.0		198	37	19
SolidColor:	54.5		192	37	20
SolidColor:	55.0		186	37	22
SolidColor:	55.5		180	37	23
SolidColor:	56.0		173	38	24
SolidColor:	56.5		167	38	25
SolidColor:	57.0		161	38	26
SolidColor:	57.5		155	38	27
SolidColor:	58.0		148	39	28
SolidColor:	58.5		142	39	29
SolidColor:	59.0		136	39	30
SolidColor:	59.5		130	40	32
SolidColor:	60.0		202	153	180
SolidColor:	60.5		201	146	176
SolidColor:	61.0		201	139	173
SolidColor:	61.5		200	133	169
SolidColor:	62.0		200	126	166
SolidColor:	62.5		199	120	162
SolidColor:	63.0		199	113	159
SolidColor:	63.5		199	106	155
SolidColor:	64.0		198	100	152
SolidColor:	64.5		198	93	148
SolidColor:	65.0		197	87	145
SolidColor:	65.5		197	80	141
SolidColor:	66.0		196	74	138
SolidColor:	66.5		196	67	134
SolidColor:	67.0		196	60	131
SolidColor:	67.5		195	54	127
SolidColor:	68.0		195	47	124
SolidColor:	68.5		194	41	120
SolidColor:	69.0		194	34	117
SolidColor:	69.5		194	28	114
SolidColor:	70.0		154	36	224
SolidColor:	70.5		149	34	219
SolidColor:	71.0		144	33	215
SolidColor:	71.5		139	32	210
SolidColor:	72.0		134	31	206
SolidColor:	72.5		129	30	201
SolidColor:	73.0		124	29	197
SolidColor:	73.5		120	28	193
SolidColor:	74.0		115	27	188
SolidColor:	74.5		110	26	184
SolidColor:	75.0		105	24	179
SolidColor:	75.5		100	23	175
SolidColor:	76.0		95	22	170
SolidColor:	76.5		91	21	166
SolidColor:	77.0		86	20	162
SolidColor:	77.5		81	19	157
SolidColor:	78.0		76	18	153
SolidColor:	78.5		71	17	148
SolidColor:	79.0		66	16	144
SolidColor:	79.5		62	15	140
SolidColor:	80.0		132	253	255
SolidColor:	80.5		128	245	249
SolidColor:	81.0		125	238	243
SolidColor:	81.5		121	231	237
SolidColor:	82.0		118	224	231
SolidColor:	82.5		115	217	225
SolidColor:	83.0		111	210	219
SolidColor:	83.5		108	203	213
SolidColor:	84.0		105	196	207
SolidColor:	84.5		101	189	201
SolidColor:	85.0		98	181	196
SolidColor:	85.5		94	174	190
SolidColor:	86.0		91	167	184
SolidColor:	86.5		88	160	178
SolidColor:	87.0		84	153	172
SolidColor:	87.5		81	146	166
SolidColor:	88.0		78	139	160
SolidColor:	88.5		74	132	154
SolidColor:	89.0		71	125	148
SolidColor:	89.5		68	118	143
SolidColor:	90.0		161	101	73
SolidColor:	90.5		155	90	65
SolidColor:	91.0		150	80	56
SolidColor:	91.5		145	70	48
SolidColor:	92.0		140	60	40
SolidColor:	92.5		135	50	32
SolidColor:	93.0		130	40	24
SolidColor:	93.5		125	30	16
SolidColor:	94.0		120	20	8
SolidColor:	94.5		115	10	1`
const reflectivity_nws = 
`product: BR
units: dBZ
step: 5

color4: -30 165 165 165 0 8 230 230 255
color: 10 0 165 255 0 8 197
color: 20 16 255 8 10 126 3
color: 35 251 238 0 210 112 2
color: 50 255 0 0 171 0 1
color: 65 247 1 249 136 63 174
color: 75 255 255 255 184 184 184
color: 85 184 184 184
color: 95 184 184 184`
const reflectivity_gr2analyst = 
`product: BR
units: dBZ
step: 10

color: 10 164 164 255 100 100 192
color: 20 64 128 255 32 64 128
color: 30 0 255 0 0 128 0
color: 40 255 255 0 255 128 0
color: 50 255 0 0 160 0 0
color: 60 255 0 255 128 0 128
color: 70 255 255 255
color: 80 128 128 128`
const reflectivity_radaromega = 
`product: BR
units: dBZ
step: 5

color4: -10 7 59 71 0
color: 0 62 69 71 191 193 197
color: 20 135 229 125 
color: 30 48 102 43
color: 35 253 227 0
color: 50 254 26 0 181 0 52
color: 60 163 0 136 254 4 250
color: 70 67 190 254 19 144 242
color: 80 166 176 150 255 231 188
color: 85 255 231 188`

const velocity = 
`Product:bv
units: KTS
step: 5
scale: 1.9426

color: -140 255 204 230
color: -120 252 0 130 109 2 150 
color: -100 110 3 151 22 13 156
color: -90  24 39 165 30 111 188
color: -80 30 111 188 40 204 220
color: -70 47 222 226 181 237 239 
color: -50 181 237 239 2 241 3
color: -40 3 234 2  0 100 0
color: -10 78 121 76 116 131 112

color: 0 137 117 122 130 51 59 
color: 10 109 0 0 242 0 7
color: 40 249 51 76 255 149 207
color: 55 253 160 201 255 232 172
color: 60 253 228 160 253 149 83 
color: 80 254 142 80 110 14 9
color: 120 110 14 9
color: 140 0 0 0

RF: 139 0 218`
const velocity_balance = 
`Product: BV
Units:   ???
Step:    5
RF:      127	0	207
SolidColor:	1	25	30	70
SolidColor:	2	26	31	73
SolidColor:	3	27	33	76
SolidColor:	4	28	34	79
SolidColor:	5	29	35	82
SolidColor:	6	30	37	85
SolidColor:	7	31	38	88
SolidColor:	8	32	39	91
SolidColor:	9	33	41	95
SolidColor:	10	33	42	98
SolidColor:	11	34	43	101
SolidColor:	12	35	45	105
SolidColor:	13	36	46	108
SolidColor:	14	37	47	111
SolidColor:	15	37	48	115
SolidColor:	16	38	50	118
SolidColor:	17	39	51	122
SolidColor:	18	39	52	125
SolidColor:	19	40	54	129
SolidColor:	20	40	55	132
SolidColor:	21	41	56	136
SolidColor:	22	41	58	140
SolidColor:	23	41	59	143
SolidColor:	24	41	60	147
SolidColor:	25	41	62	151
SolidColor:	26	41	63	154
SolidColor:	27	41	64	158
SolidColor:	28	41	66	162
SolidColor:	29	40	67	165
SolidColor:	30	39	69	169
SolidColor:	31	38	71	172
SolidColor:	32	37	72	176
SolidColor:	33	35	74	179
SolidColor:	34	33	76	182
SolidColor:	35	31	78	184
SolidColor:	36	28	80	186
SolidColor:	37	25	82	188
SolidColor:	38	22	85	189
SolidColor:	39	19	87	190
SolidColor:	40	16	89	190
SolidColor:	41	13	91	190
SolidColor:	42	12	94	190
SolidColor:	43	10	96	190
SolidColor:	44	10	98	190
SolidColor:	45	10	100	190
SolidColor:	46	11	102	189
SolidColor:	47	13	104	189
SolidColor:	48	15	106	189
SolidColor:	49	17	108	188
SolidColor:	50	19	110	188
SolidColor:	51	22	112	188
SolidColor:	52	25	114	187
SolidColor:	53	27	116	187
SolidColor:	54	30	118	187
SolidColor:	55	33	120	187
SolidColor:	56	35	122	186
SolidColor:	57	38	123	186
SolidColor:	58	41	125	186
SolidColor:	59	43	127	186
SolidColor:	60	46	129	186
SolidColor:	61	48	131	186
SolidColor:	62	51	132	186
SolidColor:	63	54	134	186
SolidColor:	64	56	136	186
SolidColor:	65	59	137	186
SolidColor:	66	62	139	186
SolidColor:	67	64	141	186
SolidColor:	68	67	143	186
SolidColor:	69	70	144	186
SolidColor:	70	72	146	186
SolidColor:	71	75	148	186
SolidColor:	72	78	149	186
SolidColor:	73	81	151	186
SolidColor:	74	83	153	186
SolidColor:	75	86	154	187
SolidColor:	76	89	156	187
SolidColor:	77	92	157	187
SolidColor:	78	95	159	187
SolidColor:	79	98	160	187
SolidColor:	80	101	162	188
SolidColor:	81	104	164	188
SolidColor:	82	107	165	188
SolidColor:	83	110	167	189
SolidColor:	84	113	168	189
SolidColor:	85	117	170	190
SolidColor:	86	120	171	190
SolidColor:	87	123	172	191
SolidColor:	88	126	174	191
SolidColor:	89	129	175	192
SolidColor:	90	133	177	192
SolidColor:	91	136	178	193
SolidColor:	92	139	180	194
SolidColor:	93	142	181	195
SolidColor:	94	145	183	195
SolidColor:	95	148	184	196
SolidColor:	96	152	186	197
SolidColor:	97	155	187	198
SolidColor:	98	158	188	199
SolidColor:	99	161	190	200
SolidColor:	100	164	191	201
SolidColor:	101	167	193	202
SolidColor:	102	170	194	203
SolidColor:	103	173	196	204
SolidColor:	104	176	197	205
SolidColor:	105	179	199	206
SolidColor:	106	182	201	207
SolidColor:	107	185	202	208
SolidColor:	108	188	204	210
SolidColor:	109	191	205	211
SolidColor:	110	193	207	212
SolidColor:	111	196	208	213
SolidColor:	112	199	210	215
SolidColor:	113	202	212	216
SolidColor:	114	205	213	217
SolidColor:	115	208	215	218
SolidColor:	116	211	217	220
SolidColor:	117	213	218	221
SolidColor:	118	216	220	222
SolidColor:	119	219	222	224
SolidColor:	120	222	224	225
SolidColor:	121	225	225	227
SolidColor:	122	227	227	228
SolidColor:	123	230	229	230
SolidColor:	124	233	231	231
SolidColor:	125	235	233	233
SolidColor:	126	238	234	234
SolidColor:	127	241	236	236
SolidColor:	128	241	236	235
SolidColor:	129	240	234	233
SolidColor:	130	239	232	230
SolidColor:	131	238	229	227
SolidColor:	132	237	227	224
SolidColor:	133	236	224	222
SolidColor:	134	235	222	219
SolidColor:	135	234	220	216
SolidColor:	136	233	217	213
SolidColor:	137	232	215	210
SolidColor:	138	231	213	207
SolidColor:	139	230	210	205
SolidColor:	140	229	208	202
SolidColor:	141	229	206	199
SolidColor:	142	228	203	196
SolidColor:	143	227	201	193
SolidColor:	144	226	199	190
SolidColor:	145	225	196	187
SolidColor:	146	225	194	184
SolidColor:	147	224	192	181
SolidColor:	148	223	189	178
SolidColor:	149	223	187	176
SolidColor:	150	222	185	173
SolidColor:	151	221	182	170
SolidColor:	152	220	180	167
SolidColor:	153	220	178	164
SolidColor:	154	219	175	161
SolidColor:	155	218	173	158
SolidColor:	156	218	171	155
SolidColor:	157	217	169	152
SolidColor:	158	216	166	150
SolidColor:	159	216	164	147
SolidColor:	160	215	162	144
SolidColor:	161	214	159	141
SolidColor:	162	214	157	138
SolidColor:	163	213	155	135
SolidColor:	164	212	153	132
SolidColor:	165	211	150	129
SolidColor:	166	211	148	127
SolidColor:	167	210	146	124
SolidColor:	168	209	143	121
SolidColor:	169	209	141	118
SolidColor:	170	208	139	115
SolidColor:	171	207	137	112
SolidColor:	172	207	134	110
SolidColor:	173	206	132	107
SolidColor:	174	205	130	104
SolidColor:	175	205	127	101
SolidColor:	176	204	125	99
SolidColor:	177	203	123	96
SolidColor:	178	202	121	93
SolidColor:	179	202	118	91
SolidColor:	180	201	116	88
SolidColor:	181	200	114	85
SolidColor:	182	199	111	83
SolidColor:	183	199	109	80
SolidColor:	184	198	107	77
SolidColor:	185	197	104	75
SolidColor:	186	196	102	72
SolidColor:	187	195	99	70
SolidColor:	188	195	97	67
SolidColor:	189	194	95	65
SolidColor:	190	193	92	63
SolidColor:	191	192	90	60
SolidColor:	192	191	87	58
SolidColor:	193	190	85	56
SolidColor:	194	190	82	54
SolidColor:	195	189	80	52
SolidColor:	196	188	77	50
SolidColor:	197	187	75	48
SolidColor:	198	186	72	46
SolidColor:	199	185	69	44
SolidColor:	200	184	67	43
SolidColor:	201	183	64	41
SolidColor:	202	182	61	40
SolidColor:	203	180	59	39
SolidColor:	204	179	56	38
SolidColor:	205	178	53	37
SolidColor:	206	177	51	37
SolidColor:	207	175	48	36
SolidColor:	208	174	46	36
SolidColor:	209	172	43	36
SolidColor:	210	171	41	36
SolidColor:	211	169	38	36
SolidColor:	212	167	36	36
SolidColor:	213	165	33	37
SolidColor:	214	163	31	37
SolidColor:	215	161	29	37
SolidColor:	216	159	27	38
SolidColor:	217	157	25	38
SolidColor:	218	155	23	39
SolidColor:	219	153	22	39
SolidColor:	220	151	20	40
SolidColor:	221	148	19	40
SolidColor:	222	146	18	40
SolidColor:	223	144	16	41
SolidColor:	224	141	16	41
SolidColor:	225	139	15	41
SolidColor:	226	136	15	41
SolidColor:	227	134	14	41
SolidColor:	228	131	14	41
SolidColor:	229	128	14	41
SolidColor:	230	126	14	41
SolidColor:	231	123	14	41
SolidColor:	232	120	14	40
SolidColor:	233	118	14	40
SolidColor:	234	115	14	39
SolidColor:	235	112	14	39
SolidColor:	236	109	14	38
SolidColor:	237	107	15	37
SolidColor:	238	104	15	37
SolidColor:	239	101	15	36
SolidColor:	240	99	14	35
SolidColor:	241	96	14	34
SolidColor:	242	94	14	33
SolidColor:	243	91	14	32
SolidColor:	244	88	14	31
SolidColor:	245	86	14	30
SolidColor:	246	83	13	29
SolidColor:	247	81	13	28
SolidColor:	248	78	13	27
SolidColor:	249	75	12	25
SolidColor:	250	73	12	24
SolidColor:	251	70	11	23
SolidColor:	252	68	11	22
SolidColor:	253	65	10	20
SolidColor:	254	63	10	19`

const diff_reflectivity = 
`Product: ZDR
Units:   DB
Step:    5

SolidColor:	-7.875	135	  0	135
SolidColor:	-7.813	  0	  0	  0
SolidColor:	-7.751	  0	  0	  0
SolidColor:	-7.689	  0	  0	  0
SolidColor:	-7.627	  0	  0	  0
SolidColor:	-7.565	  0	  0	  0
SolidColor:	-7.503	  0	  0	  0
SolidColor:	-7.441	  0	  0	  0
SolidColor:	-7.379	  0	  0	  0
SolidColor:	-7.317	  0	  0	  0
SolidColor:	-7.255	  0	  0	  0
SolidColor:	-7.193	  0	  0	  0
SolidColor:	-7.131	  0	  0	  0
SolidColor:	-7.069	  0	  0	  0
SolidColor:	-7.007	  0	  0	  0
SolidColor:	-6.945	  0	  0	  0
SolidColor:	-6.883	  0	  0	  0
SolidColor:	-6.821	  0	  0	  0
SolidColor:	-6.759	  0	  0	  0
SolidColor:	-6.697	  0	  0	  0
SolidColor:	-6.635	  0	  0	  0
SolidColor:	-6.573	  0	  0	  0
SolidColor:	-6.511	  0	  0	  0
SolidColor:	-6.449	  0	  0	  0
SolidColor:	-6.387	  0	  0	  0
SolidColor:	-6.325	  0	  0	  0
SolidColor:	-6.263	  0	  0	  0
SolidColor:	-6.201	  0	  0	  0
SolidColor:	-6.139	  0	  0	  0
SolidColor:	-6.077	  0	  0	  0
SolidColor:	-6.015	  0	  0	  0
SolidColor:	-5.953	  0	  0	  0
SolidColor:	-5.891	  0	  0	  0
SolidColor:	-5.829	  0	  0	  0
SolidColor:	-5.767	  0	  0	  0
SolidColor:	-5.705	  0	  0	  0
SolidColor:	-5.643	  0	  0	  0
SolidColor:	-5.581	  0	  0	  0
SolidColor:	-5.519	  0	  0	  0
SolidColor:	-5.457	  0	  0	  0
SolidColor:	-5.395	  0	  0	  0
SolidColor:	-5.333	  0	  0	  0
SolidColor:	-5.271	  0	  0	  0
SolidColor:	-5.209	  0	  0	  0
SolidColor:	-5.147	  0	  0	  0
SolidColor:	-5.085	  0	  0	  0
SolidColor:	-5.023	  0	  0	  0
SolidColor:	-4.961	  0	  0	  0
SolidColor:	-4.899	  0	  0	  0
SolidColor:	-4.837	  0	  0	  0
SolidColor:	-4.775	  0	  0	  0
SolidColor:	-4.713	  0	  0	  0
SolidColor:	-4.651	  0	  0	  0
SolidColor:	-4.589	  0	  0	  0
SolidColor:	-4.527	  0	  0	  0
SolidColor:	-4.465	  0	  0	  0
SolidColor:	-4.403	  0	  0	  0
SolidColor:	-4.341	  0	  0	  0
SolidColor:	-4.279	  0	  0	  0
SolidColor:	-4.217	  0	  0	  0
SolidColor:	-4.155	  0	  0	  0
SolidColor:	-4.093	  0	  0	  0
SolidColor:	-4.031	  0	  0	  0
SolidColor:	-3.969	  0	  0	  0
SolidColor:	-3.906	  3	  3	  3
SolidColor:	-3.844	  6	  6	  6
SolidColor:	-3.782	  9	  9	  9
SolidColor:	-3.720	 12	 12	 12
SolidColor:	-3.658	 15	 15	 15
SolidColor:	-3.596	 18	 18	 18
SolidColor:	-3.534	 21	 21	 21
SolidColor:	-3.472	 25	 25	 25
SolidColor:	-3.410	 28	 28	 28
SolidColor:	-3.348	 31	 31	 31
SolidColor:	-3.286	 34	 34	 34
SolidColor:	-3.224	 37	 37	 37
SolidColor:	-3.162	 40	 40	 40
SolidColor:	-3.100	 43	 43	 43
SolidColor:	-3.038	 46	 46	 46
SolidColor:	-2.976	 50	 50	 50
SolidColor:	-2.914	 53	 53	 53
SolidColor:	-2.852	 56	 56	 56
SolidColor:	-2.790	 59	 59	 59
SolidColor:	-2.728	 62	 62	 62
SolidColor:	-2.666	 65	 65	 65
SolidColor:	-2.604	 68	 68	 68
SolidColor:	-2.542	 71	 71	 71
SolidColor:	-2.480	 75	 75	 75
SolidColor:	-2.418	 78	 78	 78
SolidColor:	-2.356	 81	 81	 81
SolidColor:	-2.294	 84	 84	 84
SolidColor:	-2.232	 87	 87	 87
SolidColor:	-2.170	 90	 90	 90
SolidColor:	-2.108	 93	 93	 93
SolidColor:	-2.046	 96	 96	 96
SolidColor:	-1.984	100	100	100
SolidColor:	-1.922	102	102	102
SolidColor:	-1.860	104	104	104
SolidColor:	-1.798	107	107	107
SolidColor:	-1.736	109	109	109
SolidColor:	-1.674	111	111	111
SolidColor:	-1.612	114	114	114
SolidColor:	-1.550	116	116	116
SolidColor:	-1.488	118	118	118
SolidColor:	-1.426	121	121	121
SolidColor:	-1.364	123	123	123
SolidColor:	-1.302	125	125	125
SolidColor:	-1.240	128	128	128
SolidColor:	-1.178	130	130	130
SolidColor:	-1.116	132	132	132
SolidColor:	-1.054	135	135	135
SolidColor:	-0.992	137	137	137
SolidColor:	-0.930	139	139	139
SolidColor:	-0.868	142	142	142
SolidColor:	-0.806	144	144	144
SolidColor:	-0.744	146	146	146
SolidColor:	-0.682	148	148	148
SolidColor:	-0.620	151	151	151
SolidColor:	-0.558	153	153	153
SolidColor:	-0.496	156	156	156
SolidColor:	-0.434	161	161	161
SolidColor:	-0.372	167	167	167
SolidColor:	-0.310	172	172	172
SolidColor:	-0.248	178	178	178
SolidColor:	-0.186	184	184	184
SolidColor:	-0.124	189	189	189
SolidColor:	-0.062	195	195	195
SolidColor:	 0.000	201	201	201
SolidColor:	 0.062	185	180	195
SolidColor:	 0.124	170	160	190
SolidColor:	 0.186	155	140	185
SolidColor:	 0.248	140	120	180
SolidColor:	 0.310	105	 89	173
SolidColor:	 0.372	 70	 59	166
SolidColor:	 0.434	 35	 29	159
SolidColor:	 0.496	  0	  0	152
SolidColor:	 0.558	  4	 19	159
SolidColor:	 0.620	  8	 38	166
SolidColor:	 0.682	 13	 56	174
SolidColor:	 0.744	 17	 76	181
SolidColor:	 0.806	 21	 95	188
SolidColor:	 0.868	 26	114	196
SolidColor:	 0.930	 30	133	203
SolidColor:	 0.992	 35	152	211
SolidColor:	 1.054	 39	164	210
SolidColor:	 1.116	 43	177	210
SolidColor:	 1.178	 47	190	210
SolidColor:	 1.240	 51	203	210
SolidColor:	 1.302	 55	216	210
SolidColor:	 1.364	 59	229	210
SolidColor:	 1.426	 63	242	210
SolidColor:	 1.488	 68	255	210
SolidColor:	 1.550	 70	250	194
SolidColor:	 1.612	 72	245	179
SolidColor:	 1.674	 75	241	163
SolidColor:	 1.736	 77	236	147
SolidColor:	 1.798	 79	232	132
SolidColor:	 1.860	 82	227	116
SolidColor:	 1.922	 84	223	101
SolidColor:	 1.984	 87	219	 86
SolidColor:	 2.046	108	223	 87
SolidColor:	 2.108	129	228	 88
SolidColor:	 2.170	150	232	 89
SolidColor:	 2.232	171	237	 90
SolidColor:	 2.294	192	241	 92
SolidColor:	 2.356	213	246	 93
SolidColor:	 2.418	234	250	 94
SolidColor:	 2.480	255	255	 96
SolidColor:	 2.542	255	241	 92
SolidColor:	 2.604	255	227	 89
SolidColor:	 2.666	255	213	 85
SolidColor:	 2.728	255	199	 82
SolidColor:	 2.790	255	185	 79
SolidColor:	 2.852	255	171	 75
SolidColor:	 2.914	255	157	 72
SolidColor:	 2.976	255	144	 69
SolidColor:	 3.038	252	135	 64
SolidColor:	 3.100	250	126	 60
SolidColor:	 3.162	248	117	 56
SolidColor:	 3.224	245	108	 51
SolidColor:	 3.286	243	 99	 47
SolidColor:	 3.348	241	 90	 43
SolidColor:	 3.410	238	 81	 38
SolidColor:	 3.472	236	 72	 34
SolidColor:	 3.534	234	 63	 30
SolidColor:	 3.596	231	 54	 25
SolidColor:	 3.658	229	 45	 21
SolidColor:	 3.720	227	 36	 17
SolidColor:	 3.782	224	 27	 12
SolidColor:	 3.844	222	 18	  8
SolidColor:	 3.906	220	  9	  4
SolidColor:	 3.969	218	  0	  0
SolidColor:	 4.031	215	  0	  0
SolidColor:	 4.093	212	  0	  0
SolidColor:	 4.155	209	  0	  0
SolidColor:	 4.217	207	  0	  0
SolidColor:	 4.279	204	  0	  0
SolidColor:	 4.341	201	  0	  0
SolidColor:	 4.403	198	  0	  0
SolidColor:	 4.465	196	  0	  0
SolidColor:	 4.527	193	  0	  0
SolidColor:	 4.589	190	  0	  0
SolidColor:	 4.651	187	  0	  0
SolidColor:	 4.713	185	  0	  0
SolidColor:	 4.775	182	  0	  0
SolidColor:	 4.837	179	  0	  0
SolidColor:	 4.899	176	  0	  0
SolidColor:	 4.961	174	  0	  0
SolidColor:	 5.023	178	  8	 11
SolidColor:	 5.085	183	 16	 23
SolidColor:	 5.147	187	 24	 35
SolidColor:	 5.209	192	 32	 47
SolidColor:	 5.271	196	 40	 59
SolidColor:	 5.333	201	 48	 71
SolidColor:	 5.395	205	 56	 83
SolidColor:	 5.457	210	 65	 95
SolidColor:	 5.519	215	 73	106
SolidColor:	 5.581	219	 81	118
SolidColor:	 5.643	224	 89	130
SolidColor:	 5.705	228	 97	142
SolidColor:	 5.767	233	105	154
SolidColor:	 5.829	237	113	166
SolidColor:	 5.891	242	121	178
SolidColor:	 5.953	247	130	190
SolidColor:	 6.015	247	134	192
SolidColor:	 6.077	247	138	194
SolidColor:	 6.139	247	142	196
SolidColor:	 6.201	248	146	198
SolidColor:	 6.263	248	150	200
SolidColor:	 6.325	248	155	202
SolidColor:	 6.387	248	159	205
SolidColor:	 6.449	249	163	207
SolidColor:	 6.511	249	167	209
SolidColor:	 6.573	249	171	211
SolidColor:	 6.635	249	175	213
SolidColor:	 6.697	250	180	215
SolidColor:	 6.759	250	184	218
SolidColor:	 6.821	250	188	220
SolidColor:	 6.883	250	192	222
SolidColor:	 6.945	251	196	224
SolidColor:	 7.007	251	200	226
SolidColor:	 7.069	251	205	228
SolidColor:	 7.131	252	209	231
SolidColor:	 7.193	252	213	233
SolidColor:	 7.255	252	217	235
SolidColor:	 7.317	252	221	237
SolidColor:	 7.379	253	225	239
SolidColor:	 7.441	253	230	241
SolidColor:	 7.503	253	234	244
SolidColor:	 7.565	253	238	246
SolidColor:	 7.627	254	242	248
SolidColor:	 7.689	254	246	250
SolidColor:	 7.751	254	250	252
SolidColor:	 7.813	255	255	255
SolidColor:	 7.875	255	255	255`

const corr_coeff = 
`Product: CC
Units:	 NONE
Step:    5
SolidColor:	0.208	  0	  0	  0
SolidColor:	0.211	135	  0	135
SolidColor:	0.215	  0	  0	  0
SolidColor:	0.218	  2	  2	  2
SolidColor:	0.221	  4	  4	  4
SolidColor:	0.225	  6	  6	  6
SolidColor:	0.228	  8	  8	  8
SolidColor:	0.231	 10	 10	 10
SolidColor:	0.234	 12	 12	 13
SolidColor:	0.238	 14	 14	 15
SolidColor:	0.241	 16	 16	 17
SolidColor:	0.244	 18	 18	 19
SolidColor:	0.248	 20	 20	 21
SolidColor:	0.251	 22	 22	 23
SolidColor:	0.254	 24	 24	 25
SolidColor:	0.258	 26	 26	 28
SolidColor:	0.261	 28	 28	 30
SolidColor:	0.264	 31	 30	 32
SolidColor:	0.268	 33	 32	 34
SolidColor:	0.271	 35	 34	 36
SolidColor:	0.274	 37	 37	 38
SolidColor:	0.277	 39	 39	 41
SolidColor:	0.281	 41	 41	 43
SolidColor:	0.284	 43	 43	 45
SolidColor:	0.287	 45	 45	 47
SolidColor:	0.291	 47	 47	 49
SolidColor:	0.294	 49	 49	 51
SolidColor:	0.297	 51	 51	 54
SolidColor:	0.301	 53	 53	 56
SolidColor:	0.304	 55	 55	 58
SolidColor:	0.307	 57	 57	 60
SolidColor:	0.311	 60	 59	 62
SolidColor:	0.314	 62	 61	 65
SolidColor:	0.317	 64	 63	 67
SolidColor:	0.320	 66	 65	 69
SolidColor:	0.324	 68	 67	 71
SolidColor:	0.327	 70	 69	 73
SolidColor:	0.330	 72	 71	 75
SolidColor:	0.334	 74	 74	 78
SolidColor:	0.337	 76	 76	 80
SolidColor:	0.340	 78	 78	 82
SolidColor:	0.344	 80	 80	 84
SolidColor:	0.347	 82	 82	 86
SolidColor:	0.350	 84	 84	 88
SolidColor:	0.354	 86	 86	 91
SolidColor:	0.357	 88	 88	 93
SolidColor:	0.360	 91	 90	 95
SolidColor:	0.363	 93	 92	 97
SolidColor:	0.367	 95	 94	 99
SolidColor:	0.370	 97	 96	101
SolidColor:	0.373	 99	 98	104
SolidColor:	0.377	101	100	106
SolidColor:	0.380	103	102	108
SolidColor:	0.383	105	104	110
SolidColor:	0.387	107	106	112
SolidColor:	0.390	109	108	114
SolidColor:	0.393	111	111	117
SolidColor:	0.397	113	113	119
SolidColor:	0.400	115	115	121
SolidColor:	0.403	117	117	123
SolidColor:	0.406	120	119	125
SolidColor:	0.410	122	121	127
SolidColor:	0.413	124	123	130
SolidColor:	0.416	126	125	132
SolidColor:	0.420	128	127	134
SolidColor:	0.423	130	129	136
SolidColor:	0.426	132	131	138
SolidColor:	0.430	134	133	140
SolidColor:	0.433	136	135	143
SolidColor:	0.436	138	137	145
SolidColor:	0.439	140	139	147
SolidColor:	0.443	142	141	149
SolidColor:	0.446	144	143	151
SolidColor:	0.449	146	145	153
SolidColor:	0.453	149	148	156
SolidColor:	0.456	146	145	155
SolidColor:	0.459	144	143	155
SolidColor:	0.463	142	141	155
SolidColor:	0.466	140	139	154
SolidColor:	0.469	138	137	154
SolidColor:	0.473	136	135	154
SolidColor:	0.476	134	133	154
SolidColor:	0.479	132	130	153
SolidColor:	0.482	129	128	153
SolidColor:	0.486	127	126	153
SolidColor:	0.489	125	124	153
SolidColor:	0.492	123	122	152
SolidColor:	0.496	121	120	152
SolidColor:	0.499	119	118	152
SolidColor:	0.502	117	115	152
SolidColor:	0.506	115	113	151
SolidColor:	0.509	113	111	151
SolidColor:	0.512	110	109	151
SolidColor:	0.516	108	107	150
SolidColor:	0.519	106	105	150
SolidColor:	0.522	104	103	150
SolidColor:	0.525	102	101	150
SolidColor:	0.529	100	 98	149
SolidColor:	0.532	 98	 96	149
SolidColor:	0.535	 96	 94	149
SolidColor:	0.539	 93	 92	149
SolidColor:	0.542	 91	 90	148
SolidColor:	0.545	 89	 88	148
SolidColor:	0.549	 87	 86	148
SolidColor:	0.552	 85	 83	148
SolidColor:	0.555	 83	 81	147
SolidColor:	0.559	 81	 79	147
SolidColor:	0.562	 79	 77	147
SolidColor:	0.565	 77	 75	146
SolidColor:	0.568	 74	 73	146
SolidColor:	0.572	 72	 71	146
SolidColor:	0.575	 70	 69	146
SolidColor:	0.578	 68	 66	145
SolidColor:	0.582	 66	 64	145
SolidColor:	0.585	 64	 62	145
SolidColor:	0.588	 62	 60	145
SolidColor:	0.592	 60	 58	144
SolidColor:	0.595	 57	 56	144
SolidColor:	0.598	 55	 54	144
SolidColor:	0.602	 53	 51	144
SolidColor:	0.605	 51	 49	143
SolidColor:	0.608	 49	 47	143
SolidColor:	0.611	 47	 45	143
SolidColor:	0.615	 45	 43	142
SolidColor:	0.618	 43	 41	142
SolidColor:	0.621	 41	 39	142
SolidColor:	0.625	 38	 37	142
SolidColor:	0.628	 36	 34	141
SolidColor:	0.631	 34	 32	141
SolidColor:	0.635	 32	 30	141
SolidColor:	0.638	 30	 28	141
SolidColor:	0.641	 28	 26	140
SolidColor:	0.645	 26	 24	140
SolidColor:	0.648	 24	 22	140
SolidColor:	0.651	 22	 20	140
SolidColor:	0.654	 21	 19	142
SolidColor:	0.658	 21	 18	145
SolidColor:	0.661	 20	 18	147
SolidColor:	0.664	 20	 17	150
SolidColor:	0.668	 19	 17	152
SolidColor:	0.671	 19	 16	155
SolidColor:	0.674	 18	 15	157
SolidColor:	0.678	 18	 15	160
SolidColor:	0.681	 18	 14	163
SolidColor:	0.684	 17	 14	165
SolidColor:	0.688	 17	 13	168
SolidColor:	0.691	 16	 12	170
SolidColor:	0.694	 16	 12	173
SolidColor:	0.697	 15	 11	175
SolidColor:	0.701	 15	 11	178
SolidColor:	0.704	 15	 10	181
SolidColor:	0.707	 14	  9	183
SolidColor:	0.711	 14	  9	186
SolidColor:	0.714	 13	  8	188
SolidColor:	0.717	 13	  8	191
SolidColor:	0.721	 12	  7	193
SolidColor:	0.724	 12	  6	196
SolidColor:	0.727	 12	  6	199
SolidColor:	0.731	 11	  5	201
SolidColor:	0.734	 11	  5	204
SolidColor:	0.737	 10	  4	206
SolidColor:	0.740	 10	  3	209
SolidColor:	0.744	  9	  3	211
SolidColor:	0.747	  9	  2	214
SolidColor:	0.750	  9	  2	217
SolidColor:	0.754	 17	 10	216
SolidColor:	0.757	 26	 19	216
SolidColor:	0.760	 34	 28	216
SolidColor:	0.764	 43	 37	216
SolidColor:	0.767	 51	 46	216
SolidColor:	0.770	 60	 55	215
SolidColor:	0.774	 68	 64	215
SolidColor:	0.777	 77	 72	215
SolidColor:	0.780	 85	 81	215
SolidColor:	0.783	 94	 90	215
SolidColor:	0.787	102	 99	214
SolidColor:	0.790	111	108	214
SolidColor:	0.793	119	117	214
SolidColor:	0.797	128	126	214
SolidColor:	0.800	137	135	214
SolidColor:	0.803	134	143	205
SolidColor:	0.807	131	151	197
SolidColor:	0.810	128	159	189
SolidColor:	0.813	125	167	180
SolidColor:	0.817	122	175	172
SolidColor:	0.820	119	183	164
SolidColor:	0.823	116	191	155
SolidColor:	0.826	113	199	147
SolidColor:	0.830	110	207	139
SolidColor:	0.833	107	215	130
SolidColor:	0.836	104	223	122
SolidColor:	0.840	101	231	114
SolidColor:	0.843	 97	239	105
SolidColor:	0.846	 94	247	 97
SolidColor:	0.850	 92	255	 89
SolidColor:	0.853	 95	251	 83
SolidColor:	0.856	 98	248	 77
SolidColor:	0.859	101	245	 71
SolidColor:	0.863	104	242	 65
SolidColor:	0.866	107	238	 59
SolidColor:	0.869	110	235	 54
SolidColor:	0.873	113	232	 48
SolidColor:	0.876	117	229	 42
SolidColor:	0.879	120	226	 36
SolidColor:	0.883	123	222	 30
SolidColor:	0.886	126	219	 25
SolidColor:	0.889	129	216	 19
SolidColor:	0.893	132	213	 13
SolidColor:	0.896	135	210	  7
SolidColor:	0.899	139	207	  2
SolidColor:	0.902	146	206	  1
SolidColor:	0.906	154	205	  1
SolidColor:	0.909	162	204	  1
SolidColor:	0.912	169	204	  1
SolidColor:	0.916	177	203	  1
SolidColor:	0.919	185	202	  1
SolidColor:	0.922	193	201	  1
SolidColor:	0.926	200	201	  0
SolidColor:	0.929	208	200	  0
SolidColor:	0.932	216	199	  0
SolidColor:	0.936	224	198	  0
SolidColor:	0.939	231	198	  0
SolidColor:	0.942	239	197	  0
SolidColor:	0.945	247	196	  0
SolidColor:	0.949	255	196	  0
SolidColor:	0.952	255	176	  1
SolidColor:	0.955	255	156	  2
SolidColor:	0.959	255	137	  3
SolidColor:	0.962	255	105	  2
SolidColor:	0.965	255	 74	  1
SolidColor:	0.969	255	 43	  0
SolidColor:	0.972	245	 28	  0
SolidColor:	0.975	236	 14	  0
SolidColor:	0.979	227	  0	  0
SolidColor:	0.982	204	  0	  0
SolidColor:	0.985	182	  0	  0
SolidColor:	0.988	161	  0	  0
SolidColor:	0.992	157	  1	 28
SolidColor:	0.995	154	  3	 57
SolidColor:	0.998	151	  5	 86
SolidColor:	1.002	158	 16	 94
SolidColor:	1.005	165	 28	103
SolidColor:	1.008	172	 40	112
SolidColor:	1.012	179	 52	121
SolidColor:	1.015	186	 64	129
SolidColor:	1.018	193	 76	138
SolidColor:	1.022	200	 88	147
SolidColor:	1.025	207	100	156
SolidColor:	1.028	214	112	165
SolidColor:	1.031	221	124	173
SolidColor:	1.035	228	136	182
SolidColor:	1.038	235	148	191
SolidColor:	1.041	242	160	200
SolidColor:	1.045	250	172	209
SolidColor:	1.048	255	255	255`

const spectrum_width = {
    colors: [
        '#242424',
        '#afafaf',
        '#ff700a',
        '#b30000',
        '#f000ac',
        '#8800c2',
        '#e0fcff',
        '#b4eb00',
        '#7dd100',
    ],
    values: [
        0, 5, 8, 10, 13, 15.5, 18, 20.5, 31 // m/s
        // yes, those are strange values. here are the originals in knots:
        // 0, 10, 15, 20, 25, 30, 35, 40, 60
    ],
}

const hydrometer_class = 
`Product: HC
Units:   NONE
Step:    1

SolidColor:	 10	156	156	156
SolidColor:	 20	118	118	118
SolidColor:	 30	255	176	176
SolidColor:	 40	  0	255	255
SolidColor:	 50	  0	144	255
SolidColor:	 60	  0	251	144
SolidColor:	 70	  0	187	  0
SolidColor:	 80	208	208	 96
SolidColor:	 90	210	132	132
SolidColor:	100	255	  0	  0
SolidColor:	110	160	 20	 20
SolidColor:	120	255	255	  0
SolidColor:	130	  0	  0	  0
SolidColor:	140	231	  0	255
SolidColor:	150	119	  0	125`

const specific_differential_phase = 
`Product: KDP
Units:   Deg/km
Step:    5
SolidColor:	-2.05	135	  0	135
SolidColor:	-2.00	  0	  0	  0
SolidColor:	-1.96	  5	  5	  5
SolidColor:	-1.91	 11	 11	 11
SolidColor:	-1.86	 16	 16	 16
SolidColor:	-1.81	 22	 22	 22
SolidColor:	-1.77	 28	 28	 28
SolidColor:	-1.72	 33	 33	 33
SolidColor:	-1.67	 39	 39	 39
SolidColor:	-1.62	 44	 44	 44
SolidColor:	-1.58	 50	 50	 50
SolidColor:	-1.53	 56	 56	 56
SolidColor:	-1.48	 61	 61	 61
SolidColor:	-1.44	 67	 67	 67
SolidColor:	-1.39	 73	 73	 73
SolidColor:	-1.34	 78	 78	 78
SolidColor:	-1.29	 84	 84	 84
SolidColor:	-1.25	 89	 89	 89
SolidColor:	-1.20	 95	 95	 95
SolidColor:	-1.15	101	101	101
SolidColor:	-1.11	106	106	106
SolidColor:	-1.06	112	112	112
SolidColor:	-1.01	118	118	118
SolidColor:	-0.96	113	106	106
SolidColor:	-0.92	109	 94	 94
SolidColor:	-0.87	105	 82	 82
SolidColor:	-0.82	100	 70	 70
SolidColor:	-0.77	 96	 59	 59
SolidColor:	-0.73	 92	 47	 47
SolidColor:	-0.68	 87	 35	 35
SolidColor:	-0.63	 83	 23	 23
SolidColor:	-0.59	 79	 11	 11
SolidColor:	-0.54	 75	  0	  0
SolidColor:	-0.49	 79	  0	  2
SolidColor:	-0.44	 83	  0	  5
SolidColor:	-0.40	 87	  0	  7
SolidColor:	-0.35	 91	  0	 10
SolidColor:	-0.30	 95	  0	 12
SolidColor:	-0.25	 99	  0	 15
SolidColor:	-0.21	103	  0	 17
SolidColor:	-0.16	107	  0	 20
SolidColor:	-0.11	111	  0	 22
SolidColor:	-0.07	115	  0	 25
SolidColor:	-0.02	120	  0	 26
SolidColor:	 0.03	125	  1	 28
SolidColor:	 0.08	130	  2	 30
SolidColor:	 0.12	135	  3	 32
SolidColor:	 0.17	140	  4	 34
SolidColor:	 0.22	145	  4	 36
SolidColor:	 0.26	150	  5	 38
SolidColor:	 0.31	155	  6	 40
SolidColor:	 0.36	160	  7	 42
SolidColor:	 0.41	165	  8	 44
SolidColor:	 0.45	169	 14	 48
SolidColor:	 0.50	174	 20	 53
SolidColor:	 0.55	179	 26	 58
SolidColor:	 0.60	184	 33	 63
SolidColor:	 0.64	188	 39	 68
SolidColor:	 0.69	193	 45	 72
SolidColor:	 0.74	198	 52	 77
SolidColor:	 0.78	203	 58	 82
SolidColor:	 0.83	208	 64	 87
SolidColor:	 0.88	213	 71	 92
SolidColor:	 0.93	215	 75	101
SolidColor:	 0.97	217	 80	110
SolidColor:	 1.02	219	 85	119
SolidColor:	 1.07	221	 90	129
SolidColor:	 1.12	224	 95	138
SolidColor:	 1.16	226	100	147
SolidColor:	 1.21	228	105	157
SolidColor:	 1.26	230	110	166
SolidColor:	 1.30	232	115	175
SolidColor:	 1.35	235	120	185
SolidColor:	 1.40	226	120	184
SolidColor:	 1.45	218	121	184
SolidColor:	 1.49	209	122	184
SolidColor:	 1.54	201	123	184
SolidColor:	 1.59	192	124	184
SolidColor:	 1.64	184	125	183
SolidColor:	 1.68	175	126	183
SolidColor:	 1.73	167	127	183
SolidColor:	 1.78	158	128	183
SolidColor:	 1.82	150	129	183
SolidColor:	 1.87	145	118	184
SolidColor:	 1.92	141	107	185
SolidColor:	 1.97	137	 96	186
SolidColor:	 2.01	132	 85	187
SolidColor:	 2.06	128	 74	188
SolidColor:	 2.11	124	 63	190
SolidColor:	 2.15	119	 52	191
SolidColor:	 2.20	115	 41	192
SolidColor:	 2.25	111	 30	193
SolidColor:	 2.30	107	 20	195
SolidColor:	 2.34	106	 43	200
SolidColor:	 2.39	105	 67	206
SolidColor:	 2.44	104	 90	211
SolidColor:	 2.49	103	114	217
SolidColor:	 2.53	102	137	222
SolidColor:	 2.58	101	161	228
SolidColor:	 2.63	100	184	233
SolidColor:	 2.67	 99	208	239
SolidColor:	 2.72	 98	231	244
SolidColor:	 2.77	 98	255	250
SolidColor:	 2.82	 90	248	229
SolidColor:	 2.86	 82	241	210
SolidColor:	 2.91	 74	234	190
SolidColor:	 2.96	 66	227	170
SolidColor:	 3.01	 59	219	150
SolidColor:	 3.05	 51	212	130
SolidColor:	 3.10	 43	205	110
SolidColor:	 3.15	 35	198	 90
SolidColor:	 3.19	 27	191	 70
SolidColor:	 3.24	 20	185	 50
SolidColor:	 3.29	 19	192	 46
SolidColor:	 3.34	 18	199	 42
SolidColor:	 3.38	 17	206	 38
SolidColor:	 3.43	 16	213	 34
SolidColor:	 3.48	 15	220	 30
SolidColor:	 3.52	 14	227	 26
SolidColor:	 3.57	 13	234	 22
SolidColor:	 3.62	 12	241	 18
SolidColor:	 3.67	 11	248	 14
SolidColor:	 3.71	 10	255	 10
SolidColor:	 3.76	 22	255	  9
SolidColor:	 3.81	 34	255	  9
SolidColor:	 3.86	 46	255	  8
SolidColor:	 3.90	 58	255	  8
SolidColor:	 3.95	 71	255	  7
SolidColor:	 4.00	 83	255	  7
SolidColor:	 4.04	 95	255	  6
SolidColor:	 4.09	108	255	  6
SolidColor:	 4.14	120	255	  5
SolidColor:	 4.19	132	255	  5
SolidColor:	 4.23	144	255	  4
SolidColor:	 4.28	157	255	  4
SolidColor:	 4.33	169	255	  3
SolidColor:	 4.38	181	255	  3
SolidColor:	 4.42	193	255	  2
SolidColor:	 4.47	206	255	  2
SolidColor:	 4.52	218	255	  1
SolidColor:	 4.56	230	255	  1
SolidColor:	 4.61	242	255	  0
SolidColor:	 4.66	255	255	  0
SolidColor:	 4.71	255	248	  1
SolidColor:	 4.75	255	241	  2
SolidColor:	 4.80	255	234	  3
SolidColor:	 4.85	255	227	  4
SolidColor:	 4.89	255	221	  5
SolidColor:	 4.94	255	214	  6
SolidColor:	 4.99	255	207	  7
SolidColor:	 5.04	255	200	  8
SolidColor:	 5.08	255	194	  9
SolidColor:	 5.13	255	187	 10
SolidColor:	 5.18	255	180	 11
SolidColor:	 5.23	255	173	 12
SolidColor:	 5.27	255	167	 13
SolidColor:	 5.32	255	160	 14
SolidColor:	 5.37	255	153	 15
SolidColor:	 5.41	255	146	 16
SolidColor:	 5.46	255	140	 17
SolidColor:	 5.51	255	133	 18
SolidColor:	 5.56	255	126	 19
SolidColor:	 5.60	255	120	 20
SolidColor:	 5.65	255	122	 22
SolidColor:	 5.70	255	124	 25
SolidColor:	 5.75	255	126	 28
SolidColor:	 5.79	255	128	 31
SolidColor:	 5.84	255	130	 33
SolidColor:	 5.89	255	132	 36
SolidColor:	 5.93	255	134	 39
SolidColor:	 5.98	255	137	 41
SolidColor:	 6.03	255	139	 44
SolidColor:	 6.08	255	141	 47
SolidColor:	 6.12	255	143	 50
SolidColor:	 6.17	255	145	 52
SolidColor:	 6.22	255	147	 55
SolidColor:	 6.26	255	149	 58
SolidColor:	 6.31	255	151	 61
SolidColor:	 6.36	255	153	 63
SolidColor:	 6.41	255	156	 66
SolidColor:	 6.45	255	158	 69
SolidColor:	 6.50	255	160	 72
SolidColor:	 6.55	255	162	 74
SolidColor:	 6.60	255	164	 77
SolidColor:	 6.64	255	166	 80
SolidColor:	 6.69	255	168	 83
SolidColor:	 6.74	255	170	 86
SolidColor:	 6.78	255	173	 88
SolidColor:	 6.83	255	175	 91
SolidColor:	 6.88	255	177	 94
SolidColor:	 6.93	255	179	 97
SolidColor:	 6.97	255	181	 99
SolidColor:	 7.02	255	183	102
SolidColor:	 7.07	255	185	105
SolidColor:	 7.12	255	187	108
SolidColor:	 7.16	255	190	110
SolidColor:	 7.21	255	192	113
SolidColor:	 7.26	255	194	116
SolidColor:	 7.30	255	196	119
SolidColor:	 7.35	255	198	121
SolidColor:	 7.40	255	200	124
SolidColor:	 7.45	255	202	127
SolidColor:	 7.49	255	205	130
SolidColor:	 7.54	255	205	132
SolidColor:	 7.59	255	206	134
SolidColor:	 7.64	255	207	137
SolidColor:	 7.68	255	208	139
SolidColor:	 7.73	255	209	142
SolidColor:	 7.78	255	210	144
SolidColor:	 7.82	255	211	147
SolidColor:	 7.87	255	212	149
SolidColor:	 7.92	255	213	152
SolidColor:	 7.97	255	214	154
SolidColor:	 8.01	255	215	156
SolidColor:	 8.06	255	216	159
SolidColor:	 8.11	255	217	161
SolidColor:	 8.15	255	218	164
SolidColor:	 8.20	255	219	166
SolidColor:	 8.25	255	220	169
SolidColor:	 8.30	255	221	171
SolidColor:	 8.34	255	222	174
SolidColor:	 8.39	255	223	176
SolidColor:	 8.44	255	224	179
SolidColor:	 8.49	255	225	181
SolidColor:	 8.53	255	226	183
SolidColor:	 8.58	255	227	186
SolidColor:	 8.63	255	228	188
SolidColor:	 8.67	255	229	191
SolidColor:	 8.72	255	230	193
SolidColor:	 8.77	255	231	196
SolidColor:	 8.82	255	232	198
SolidColor:	 8.86	255	233	201
SolidColor:	 8.91	255	234	203
SolidColor:	 8.96	255	235	205
SolidColor:	 9.01	255	236	208
SolidColor:	 9.05	255	237	210
SolidColor:	 9.10	255	238	213
SolidColor:	 9.15	255	239	215
SolidColor:	 9.19	255	240	218
SolidColor:	 9.24	255	241	220
SolidColor:	 9.29	255	242	223
SolidColor:	 9.34	255	243	225
SolidColor:	 9.38	255	244	228
SolidColor:	 9.43	255	245	230
SolidColor:	 9.48	255	246	232
SolidColor:	 9.52	255	247	235
SolidColor:	 9.57	255	248	237
SolidColor:	 9.62	255	249	240
SolidColor:	 9.67	255	250	242
SolidColor:	 9.71	255	251	245
SolidColor:	 9.76	255	252	247
SolidColor:	 9.81	255	253	250
SolidColor:	 9.86	255	254	252
SolidColor:	 9.90	255	255	255
SolidColor:	 9.95	255	255	255`

const vertically_integrated_liquid = {
    colors: [
        'rgb(132, 132, 132)',
        'rgb(8, 183, 183)',
        'rgb(19, 14, 146)',

        'rgb(4, 204, 27)',
        'rgb(4, 100, 4)',

        'rgb(204, 193, 2)',
        'rgb(183, 107, 0)',

        'rgb(230, 31, 5)',
        'rgb(133, 14, 52)',

        'rgb(168, 0, 101)',
        'rgb(219, 152, 193)',

        'rgb(255, 254, 255)',
        'rgb(187, 188, 188)'
    ],
    values: [
        0, 4, 17,
        17, 30,
        30, 43,
        43, 56,
        56, 71,
        71, 79.5
    ],
}

/**
 * This is the main object that contains
 * the colormaps for all products.
 */
const product_colors = {
    range_folded: range_folded,
    range_folded_val: range_folded_val,

    DVL: vertically_integrated_liquid,
    HHC: colortable_parser(hydrometer_class),

    N0B: colortable_parser(reflectivity),
    N1B: colortable_parser(reflectivity),
    N2B: colortable_parser(reflectivity),
    N3B: colortable_parser(reflectivity),

    N0C: colortable_parser(corr_coeff),
    N1C: colortable_parser(corr_coeff),
    N2C: colortable_parser(corr_coeff),
    N3C: colortable_parser(corr_coeff),

    N0G: colortable_parser(velocity),
    N1G: colortable_parser(velocity),
    N2G: colortable_parser(velocity),
    N3G: colortable_parser(velocity),
    NAG: colortable_parser(velocity),
    NBG: colortable_parser(velocity),

    N0H: colortable_parser(hydrometer_class),
    N1H: colortable_parser(hydrometer_class),
    N2H: colortable_parser(hydrometer_class),
    N3H: colortable_parser(hydrometer_class),

    N0S: {
        colors: [
            'rgb(155, 31, 139)',
            'rgb(155, 31, 139)',

            'rgb(48, 7, 147)',
            'rgb(48, 7, 147)',

            'rgb(64, 128, 189)',
            'rgb(64, 128, 189)',

            'rgb(133, 226, 231)',
            'rgb(133, 226, 231)',

            'rgb(163, 240, 186)',
            'rgb(163, 240, 186)',

            'rgb(96, 209, 62)',
            'rgb(96, 209, 62)',

            'rgb(56, 127, 33)',
            'rgb(56, 127, 33)',

            'rgb(117, 131, 114)',
            'rgb(117, 131, 114)',

            'rgb(121, 21, 13)',
            'rgb(121, 21, 13)',

            'rgb(201, 43, 30)',
            'rgb(201, 43, 30)',

            'rgb(235, 123, 169)',
            'rgb(235, 123, 169)',

            'rgb(251, 229, 166)',
            'rgb(251, 229, 166)',

            'rgb(242, 162, 103)',
            'rgb(242, 162, 103)',

            'rgb(196, 104, 67)',
            'rgb(196, 104, 67)',

            'rgb(115, 20, 198)',
            'rgb(115, 20, 198)'
        ],
        values: [
            1, 2,
            2, 3,
            3, 4,
            4, 5,
            5, 6,
            6, 7,
            7, 8,
            8, 9,
            9, 10,
            10, 11,
            11, 12,
            12, 13,
            13, 14,
            14, 15,
            15, 16
        ],
    },
    N0U: colortable_parser(velocity),
    N1U: colortable_parser(velocity),
    N2U: colortable_parser(velocity),
    N3U: colortable_parser(velocity),

    N0X: colortable_parser(diff_reflectivity),
    N1X: colortable_parser(diff_reflectivity),
    N2X: colortable_parser(diff_reflectivity),
    N3X: colortable_parser(diff_reflectivity),

    NSW: spectrum_width,

    N0Q: colortable_parser(reflectivity),
    N1Q: colortable_parser(reflectivity),
    N2Q: colortable_parser(reflectivity),
    N3Q: colortable_parser(reflectivity),

    PHI: {
        colors: [
            'rgb(255, 255, 255)',
            'rgb(210, 210, 180)',
            'rgb(10, 20, 95)',
            'rgb(0, 255, 0)',
            'rgb(30, 100, 0)',
            'rgb(255, 255, 0)',
            'rgb(255, 125, 0)',
            'rgb(90, 0, 0)',
            'rgb(255, 140, 255)'
        ],
        values: [
            0, 15, 30, 45, 60, 75, 90, 120, 180
        ],
    },
    REF: colortable_parser(reflectivity),
    RHO: colortable_parser(corr_coeff),
    SW: spectrum_width, // 'SW '

    TV0: colortable_parser(velocity),
    TV1: colortable_parser(velocity),
    TV2: colortable_parser(velocity),

    TZL: colortable_parser(reflectivity),
    TZ0: colortable_parser(reflectivity),
    TZ1: colortable_parser(reflectivity),
    TZ2: colortable_parser(reflectivity),
    TZ3: colortable_parser(reflectivity),

    VEL: colortable_parser(velocity),
    ZDR: colortable_parser(diff_reflectivity),

    N0K: colortable_parser(specific_differential_phase),
    N1K: colortable_parser(specific_differential_phase),
    N2K: colortable_parser(specific_differential_phase),
    N3K: colortable_parser(specific_differential_phase),


    // these are for the colortable menu
    REF1: colortable_parser(reflectivity),
    REF2: colortable_parser(reflectivity_radarscope),
    REF3: colortable_parser(reflectivity_nws),
    REF4: colortable_parser(reflectivity_gr2analyst),
    REF5: colortable_parser(reflectivity_radaromega),
    VEL1: colortable_parser(velocity),
    VEL2: {
        colors: [
            'rgb(24, 28, 67)', // -120
            'rgb(41, 56, 136)', // -100
            'rgb(12, 94, 190)', // -80
            'rgb(56, 136, 186)', // -60
            'rgb(117, 170, 190)', // -40
            'rgb(182, 201, 207)', // -20
            'rgb(241, 236, 235)', // 0
            'rgb(223, 187, 176)', // 20
            'rgb(208, 139, 115)', // 40
            'rgb(191, 87, 58)', // 60
            'rgb(165, 33, 37)', // 80
            'rgb(115, 14, 39)', // 100
            'rgb(60, 9, 18)' // 120
        ],
        values: [
            -120, -100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 120
        ],
    },
    RHO1: colortable_parser(corr_coeff),
    ZDR1: colortable_parser(diff_reflectivity),
    KDP1: colortable_parser(specific_differential_phase),
    DVL1: vertically_integrated_liquid,
}

module.exports = product_colors;
},{"./colortable_parser":3}],3:[function(require,module,exports){
// https://www.grlevelx.com/manuals/color_tables/files_color_table.htm
function colortable_parser(colortable_string, should_print = false) {
    // console.log(colortable_string);

    var colors = [];
    var values = [];
    var range_fold = undefined;

    // this removes empty lines and splits at new lines.
    // https://stackoverflow.com/a/16369666/18758797
    const lines = colortable_string.replace(/(^[ \t]*\n)/gm, '').replaceAll('\r', '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
        const prev_line = lines[i - 1]?.toLowerCase();
        const cur_line = lines[i].toLowerCase();
        const next_line = lines[i + 1]?.toLowerCase();
        if (['color', 'color4', 'solidcolor', 'solidcolor4', 'rf'].some(prefix => cur_line.startsWith(prefix))) {
            // https://stackoverflow.com/a/32727737/18758797
            const prev_line_parts = prev_line?.replaceAll(',', '').split(/\s+/).filter(n => n);
            const line_parts = cur_line.replaceAll(',', '').split(/\s+/).filter(n => n);
            const next_line_parts = next_line?.replaceAll(',', '').split(/\s+/).filter(n => n);
            const prefix = line_parts[0];
            var has_alpha = false;
            if (prefix.includes('4')) { has_alpha = true; }

            if (prefix.includes('rf')) {
                const [r, g, b] = [line_parts[1], line_parts[2], line_parts[3]];
                var color_string = `rgb(${r}, ${g}, ${b})`;
                range_fold = color_string;
            } else {
                const prev_value = parseFloat(prev_line_parts?.[1]);
                const value = parseFloat(line_parts[1]);
                const next_value = parseFloat(next_line_parts?.[1]);
                const [r, g, b] = [line_parts[2], line_parts[3], line_parts[4]];
                var color_string = `rgb(${r}, ${g}, ${b}`;
                // var a;
                // if (has_alpha) {
                //     a = line_parts[5];
                //     color_string += `, ${a}`;
                //     color_string = color_string.replaceAll('rgb', 'rgba');
                // }
                color_string += ')';

                colors.push(color_string);
                values.push(value);

                if (prefix.includes('solidcolor')) {
                    colors.push(color_string);
                    if (!Number.isNaN(next_value)) {
                        values.push(next_value);
                    } else { // this is for hydrometer products, you generally can't use SolidColors as the last color
                        const spacing = value - prev_value;
                        values.push(value + spacing);
                    }
                }

                check_length = 5;
                if (has_alpha) {
                    check_length = 6;
                }
                if (line_parts.length > check_length) {
                    var offset = 0;
                    if (has_alpha) {
                        offset = 1;
                    }
                    const [r2, g2, b2] = [line_parts[5 + offset], line_parts[6 + offset], line_parts[7 + offset]];
                    var color_string2 = `rgb(${r2}, ${g2}, ${b2}`;
                    // var a2;
                    // if (has_alpha) {
                    //     a2 = line_parts[9];
                    //     color_string2 += `, ${a2}`;
                    //     color_string2 = color_string2.replaceAll('rgb', 'rgba');
                    // }
                    color_string2 += ')';

                    colors.push(color_string2);
                    if (!Number.isNaN(next_value)) {
                        values.push(next_value);
                    }
                }
            }
        }
    }

    const return_obj = {
        'colors': colors,
        'values': values,
    }
    if (range_fold != undefined) {
        return_obj.range_fold = range_fold;
    }
    if (should_print) {
        console.log(return_obj)
    }
    return return_obj;
}

module.exports = colortable_parser;
},{}],4:[function(require,module,exports){
(function (Buffer){(function (){
const BIG_ENDIAN = 0;
const LITTLE_ENDIAN = 1;

class RandomAccessFile {
    /**
     * Store an ArrayBuffer and add functionality for random access
     * Unless otherwise noted all read functions advance the file's pointer by the length of the data read
     *
     * @param {ArrayBuffer|string} file An ArrayBuffer or string to load for random access
     * @param {number} endian Endianess of the file constants BIG_ENDIAN and LITTLE_ENDIAN are provided
     */
    constructor(file, endian = BIG_ENDIAN) {
		// https://stackoverflow.com/a/18002694/18758797
		if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
			this.offset = 0;
			this.buffer = null;

			// set the binary endian order
			if (endian < 0) return;
			this.bigEndian = (endian === BIG_ENDIAN);

			// string to ArrayBuffer if string was provided
			if (typeof file === 'string') {
				const encoder = new TextEncoder();
				this.buffer = encoder.encode(file).buffer;
			} else {
				// load the ArrayBuffer directly
				this.buffer = file;
			}

			// set up local read functions so we don't constantly query endianess
			this.readFloatLocal = (offset) => {
				const result = this.bigEndian ?
					new DataView(this.buffer.buffer, offset, 4).getFloat32(0, false) :
					new DataView(this.buffer.buffer, offset, 4).getFloat32(0, true);
				this.offset += 4;
				return result;
			};

			this.readIntLocal = (offset, byteLength) => {
				const result = this.bigEndian ?
					new DataView(this.buffer.buffer, offset, byteLength).getUint32(0, false) :
					new DataView(this.buffer.buffer, offset, byteLength).getUint32(0, true);
				this.offset += byteLength;
				return result;
			};

			this.readSignedIntLocal = (offset, byteLength) => {
				const result = this.bigEndian ?
					new DataView(this.buffer.buffer, offset, byteLength).getInt32(0, false) :
					new DataView(this.buffer.buffer, offset, byteLength).getInt32(0, true);
				this.offset += byteLength;
				return result;
			};
		} else {
			this.offset = 0;
			this.buffer = null;

			// set the binary endian order
			if (endian < 0) return;
			this.bigEndian = (endian === BIG_ENDIAN);

			// string to buffer if string was provided
			if (typeof file === 'string') {
				this.buffer = Buffer.from(file, 'binary');
			} else {
				// load the buffer directly
				this.buffer = file;
			}

			// set up local read functions so we don't constantly query endianess
			if (this.bigEndian) {
				this.readFloatLocal = this.buffer.readFloatBE.bind(this.buffer);
				this.readIntLocal = this.buffer.readUIntBE.bind(this.buffer);
				this.readSignedIntLocal = this.buffer.readIntBE.bind(this.buffer);
			}	else {
				this.readFloatLocal = this.buffer.readFloatLE.bind(this.buffer);
				this.readIntLocal = this.buffer.readUIntLE.bind(this.buffer);
				this.readSignedIntLocal = this.buffer.readIntLE.bind(this.buffer);
			}
		}
    }

	/**
	 * Get buffer length
	 *
	 * @category Positioning
	 * @returns {number}
	 */
	getLength() {
		return this.buffer.length;
	}

	/**
	 * Get current position in the file
	 *
	 * @category Positioning
	 * @returns {number}
	 */
	getPos() {
		return this.offset;
	}

	/**
	 * Seek to a provided buffer offset
	 *
	 * @category Positioning
	 * @param {number} position Byte offset
	 */
	seek(position) {
		this.offset = position;
	}

	/**
	 * Read data without advancing the offset
	 *
	 * @category Positioning
	 * @param {number} position Byte offset
	 */
	peek(position) {
		var origOffset = this.offset;
        var peekedData = this.read(position);
        this.offset = origOffset;
        return peekedData;
	}

	/**
	 * Read a string of a specificed length from the buffer
	 *
	 * @category Data
	 * @param {number} length Length of string to read
	 * @returns {string}
	 */
	readString(length) {
		const data = this.buffer.toString('utf-8', this.offset, (this.offset += length));

		return data;
	}

	/**
	 * Read a float from the buffer
	 *
	 * @category Data
	 * @returns {number}
	 */
	readFloat() {
		const float = this.readFloatLocal(this.offset);
		this.offset += 4;

		return float;
	}

	/**
	 * Read a 4-byte unsigned integer from the buffer
	 *
	 * @category Data
	 * @returns {number}
	 */
	readInt() {
		const int = this.readIntLocal(this.offset, 4);
		this.offset += 4;

		return int;
	}

	/**
	 * Read a 2-byte unsigned integer from the buffer
	 *
	 * @category Data
	 * @returns {number}
	 */
	readShort() {
		const short = this.readIntLocal(this.offset, 2);
		this.offset += 2;

		return short;
	}

	/**
	 * Read a 2-byte signed integer from the buffer
	 *
	 * @category Data
	 * @returns {number}
	 */
	readSignedInt() {
		const short = this.readSignedIntLocal(this.offset, 2);
		this.offset += 2;

		return short;
	}

	/**
	 * Read a single byte from the buffer
	 *
	 * @category Data
	 * @returns {number}
	 */
	readByte() {
		return this.read();
	}

	// read a set number of bytes from the buffer
	/**
	 * Read a set number of bytes from the buffer
	 *
	 * @category Data
	 * @param {number} length Number of bytes to read
	 * @returns {number|number[]} number if length = 1, otherwise number[]
	 */
	read(length) {
		let data = null;
		if (length == undefined) {
			length = this.buffer.length;
		}

		if (length > 1) {
			data = this.buffer.slice(this.offset, this.offset + length);
			this.offset += length;
		} else {
			data = this.buffer[this.offset];
			this.offset += 1;
		}
		return data;
	}

	/**
	 * Advance the pointer forward a set number of bytes
	 *
	 * @category Positioning
	 * @param {number} length Number of bytes to skip
	 */
	skip(length) {
		this.offset += length;
	}
}

module.exports = RandomAccessFile;
// module.exports.RandomAccessFile = RandomAccessFile;
// module.exports.BIG_ENDIAN = BIG_ENDIAN;
// module.exports.LITTLE_ENDIAN = LITTLE_ENDIAN;
}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":24}],5:[function(require,module,exports){
(function (Buffer){(function (){
/*
 * app/radar/libnexrad/l2_browser_entry.js
 * Standalone browser bundle of the app's OWN Level 2 parser AND factory, for
 * pages that are not the radar page — currently the Graphics Studio.
 *
 * WHY THIS EXISTS
 * The Graphics Studio has to draw the same radar the radar page draws. It
 * cannot import dist/bundle.js, because that entry boots the whole application
 * (constructs a Mapbox map, builds menus, expects the radar page's DOM).
 *
 * So the parser and factory are bundled here on their own. The factory's
 * browser-UI dependencies — the map, the plotter, the elevation menu, the
 * dealiaser, the file-info panel — are replaced with empty stubs at BUILD time
 * (see the ignore list in tools/build.js). That is the same treatment
 * nws_radar_l2.js applies to run this decoder in Node, for the same reason:
 * those modules are only touched by plot(), which nothing here calls.
 *
 * IMPORTANT: use the real Factory's accessors — get_azimuth_angles(),
 * get_ranges(), get_data(). An earlier version of this file reimplemented that
 * logic and silently picked the WRONG SWEEP (elevation 2 at 1192 gates instead
 * of elevation 1 at 1832), producing different values from the radar page.
 * Sharing the real implementation is the whole point; do not reintroduce a copy.
 *
 * Built by tools/build.js to dist/l2_bundle.js, exposed as window.VortexL2.
 */

const NEXRADLevel2File = require('./level2/level2_parser');
const Level2Factory = require('./level2/level2_factory');
const colormaps = require('../colormaps/colormaps');
// The app builds its colour scales with chroma in LAB space. Ship it too, so a
// studio graphic can build the IDENTICAL scale rather than approximating it.
const chroma = require('chroma-js');

// Copy of scaleValues() from app/core/utils.js (that module is browser-coupled
// to the radar page). Pure arithmetic, safe to duplicate.
function scaleValues(values, product) {
  if (['N0G', 'N0U', 'VEL', 'TVX', 'TV0', 'TV1', 'TV2'].includes(product)) {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] / 1.944; }
  } else if (product === 'N0S') {
    for (const i in values) { if (values[i] !== 999) values[i] = values[i] - 0.5; }
  }
  for (let i = 0; i < values.length; i++) {
    if (values[i] === values[i + 1]) values[i] = values[i] - 0.00001;
  }
  return values;
}

/**
 * Parse a volume into a Level2Factory.
 *
 * Accepts an ArrayBuffer (what fetch().arrayBuffer() gives you) or a Buffer.
 * The wrap matters: the parser hands its input to RandomAccessFile, which reads
 * it with Buffer methods, so a bare ArrayBuffer throws. loaders_nexrad.js does
 * the same Buffer.from() before calling this parser — this is not an extra copy
 * for its own sake, it is the calling convention.
 */
function parseVolume(input, filename) {
  return new Promise((resolve, reject) => {
    try {
      const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
      // eslint-disable-next-line no-new
      new NEXRADLevel2File(buf, (radarObj) => {
        try { resolve(new Level2Factory(radarObj)); } catch (e) { reject(e); }
      }, filename);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Lowest-elevation sweep that actually carries this product. Split-cut VCPs
 * scan reflectivity and velocity in separate sweeps at the same nominal tilt,
 * so sweep 1 is not reliably the one holding VEL.
 */
function bestElevationFor(factory, product) {
  let best = null;
  let bestAngle = Infinity;
  for (let e = 1; e <= factory.nscans; e++) {
    const sweep = factory.grouped_sweeps[e];
    if (!sweep || !sweep[0] || !sweep[0][product] || !sweep[0][product].ngates) continue;
    let angle;
    try { angle = factory.get_elevation_angle(e); } catch (err) { continue; }
    if (angle < bestAngle) { bestAngle = angle; best = e; }
  }
  return best;
}

/**
 * Pull one sweep out of a decoded volume, using the factory's own accessors.
 * @returns {object|null} { product, elevation, elevationAngle, azimuths, ranges,
 *                          data, nyquist, gateSpacingKm }
 */
function sweepFrom(factory, product) {
  const elevation = bestElevationFor(factory, product);
  if (elevation == null) return null;

  const data = factory.get_data(product, elevation);
  if (!data || !data.length) return null;

  // get_ranges() returns ngates+1 EDGES; a per-gate lookup wants centres.
  const edges = factory.get_ranges(product, elevation);
  const ranges = new Array(Math.max(0, edges.length - 1));
  for (let i = 0; i < ranges.length; i++) ranges[i] = (edges[i] + edges[i + 1]) / 2;

  let elevationAngle = null;
  let nyquist = null;
  try { elevationAngle = factory.get_elevation_angle(elevation); } catch (e) { /* optional */ }
  try {
    const n = factory.get_nyquist_vel(elevation);
    if (typeof n === 'number' && n > 0) nyquist = n;
  } catch (e) { /* optional */ }

  return {
    product,
    elevation,
    elevationAngle,
    azimuths: factory.get_azimuth_angles(elevation),
    ranges,
    data,
    nyquist,
    gateSpacingKm: ranges.length > 1 ? (ranges[1] - ranges[0]) : null,
  };
}

/** Radar site + position from the decoded volume. */
function locationFrom(factory) {
  let loc = null;
  try { loc = factory.get_location(); } catch (e) { loc = null; }
  const site = String(factory.station || '').replace(/\0/g, '').trim();
  if (!loc || !isFinite(loc[0])) return null;
  return { site, lat: loc[0], lon: loc[1], elev: loc[2] || 0 };
}

/** Volume scan time. */
function timeFrom(factory) {
  try {
    const t = factory.get_date();
    const d = (t instanceof Date) ? t : new Date(t);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}

const api = {
  NEXRADLevel2File,
  Level2Factory,
  parseVolume,
  sweepFrom,
  bestElevationFor,
  locationFrom,
  timeFrom,
  colormaps,
  scaleValues,
  chroma,
};

if (typeof window !== 'undefined') window.VortexL2 = api;

module.exports = api;

}).call(this)}).call(this,require("buffer").Buffer)
},{"../colormaps/colormaps":2,"./level2/level2_factory":8,"./level2/level2_parser":9,"buffer":24,"chroma-js":26}],6:[function(require,module,exports){
(function (Buffer){(function (){
const compressjs = require('../../../../lib/compressjs/main');
const RandomAccessFile = require('../buffer_tools/RandomAccessFile');
const BufferPack = require('bufferpack');
const level2_constants = require('./level2_constants');

function _structure_size(structure) {
    /* Find the size of a structure in bytes. */
    var format = '>' + structure.map(i => i[1]).join('');
    var size = BufferPack.calcLength(format);
    return size;
}

module.exports = function (self) {
    self.addEventListener('message', function (ev) {
        var seen_length = 0;
        class RadarDecompressor {
            constructor() {
                this.unused_data;
            }
            _decompress_chunk(chunk) {
                const algorithm = compressjs.Bzip2;
                return algorithm.decompressFile(chunk);
                // skip 32 bits 'BZh9' header
                // return bzip.decodeBlock(chunk, 32);
                // https://github.com/jvrousseau/bzip2.js
                // return bzip2.simple(bzip2.array(chunk));
            }
            decompress(data) {
                this.compressedData = data;

                var rafData = new RandomAccessFile(data);
                var blockSize = Math.abs(rafData.readInt());

                var block_percent = blockSize / ev.data.length;
                seen_length += block_percent;
                var percent_loaded = parseFloat((seen_length * 100).toFixed(1));
                if (percent_loaded > 100) { percent_loaded = 100 }
                self.postMessage({ 'message': 'progress', 'data': percent_loaded });

                data = data.slice(level2_constants.CONTROL_WORD_SIZE, data.length);
                var uncompressed = this._decompress_chunk(data);

                this.unused_data = data.slice(blockSize, data.length);
                if (blockSize > data.length) {
                    this.unused_data = new Buffer.alloc(0);
                }

                return uncompressed;
            }
        }

        function _decompress_records(file_handler) {
            /* Decompressed the records from an BZ2 compressed Archive 2 file. */
            file_handler.seek(0);
            // read all data from the file
            var cbuf = file_handler.peek();
            var decompressor = new RadarDecompressor();
            // skip the radar file header (24 bits)
            var skip = _structure_size(level2_constants.VOLUME_HEADER);
            // initialize the buffer with all of the radar file's data, except for the header
            var buf = [decompressor.decompress(cbuf.slice(skip, cbuf.length))];
            // while there's still data to decompress
            while (decompressor.unused_data.length) {
                // store the remaining compressed data
                cbuf = decompressor.unused_data;
                // create a new RadarDecompressor
                decompressor = new RadarDecompressor();
                var decompressed = decompressor.decompress(cbuf);
                // uncompress and push to the final buffer
                buf.push(decompressed);
            }
            // combine the array of Uint8Arrays + 1 buffer to a single buffer
            var finalBuffer = Buffer.concat(buf);
            // trim the 'COMPRESSION_RECORD_SIZE' from the start of the buffer
            finalBuffer = finalBuffer.slice(level2_constants.COMPRESSION_RECORD_SIZE, finalBuffer.length);
            return finalBuffer;
        }

        var fh = new RandomAccessFile(ev.data);
        const buf = _decompress_records(fh);

        self.postMessage({ 'message': 'finish', 'data': buf });
    })
}
}).call(this)}).call(this,require("buffer").Buffer)
},{"../../../../lib/compressjs/main":21,"../buffer_tools/RandomAccessFile":4,"./level2_constants":7,"buffer":24,"bufferpack":25}],7:[function(require,module,exports){
// format of structure elements
// section 3.2.1, page 3-2
const CODE1 = 'B';
const CODE2 = 'H';
const INT1 = 'B';
const INT2 = 'H';
const INT4 = 'I';
const REAL4 = 'f';
const REAL8 = 'd';
const SINT1 = 'b';
const SINT2 = 'h';
const SINT4 = 'i';

const level2_constants = {
    // NEXRAD Level II file structures and sizes
    // The deails on these structures are documented in:
    // "Interface Control Document for the Achive II/User" RPG Build 12.0
    // Document Number 2620010E
    // and
    // "Interface Control Document for the RDA/RPG" Open Build 13.0
    // Document Number 2620002M
    // Tables and page number refer to those in the second document unless
    // otherwise noted.
    RECORD_SIZE: 2432,
    COMPRESSION_RECORD_SIZE: 12,
    CONTROL_WORD_SIZE: 4,

    // Figure 1 in Interface Control Document for the Archive II/User
    // page 7-2
    VOLUME_HEADER: [
        ['tape', '9s'],
        ['extension', '3s'],
        ['date', 'I'],
        ['time', 'I'],
        ['icao', '4s']
    ],

    // Table II Message Header Data
    // page 3-7
    MSG_HEADER: [
        ['size', INT2],  // size of data, no including header
        ['channels', INT1],
        ['type', INT1],
        ['seq_id', INT2],
        ['date', INT2],
        ['ms', INT4],
        ['segments', INT2],
        ['seg_num', INT2],
    ],

    // Table XVII Digital Radar Generic Format Blocks (Message Type 31)
    // pages 3-87 to 3-89
    MSG_31: [
        ['id', '4s'],  // 0-3
        ['collect_ms', INT4],  // 4-7
        ['collect_date', INT2],  // 8-9
        ['azimuth_number', INT2],  // 10-11
        ['azimuth_angle', REAL4],  // 12-15
        ['compress_flag', CODE1],  // 16
        ['spare_0', INT1],  // 17
        ['radial_length', INT2],  // 18-19
        ['azimuth_resolution', CODE1],  // 20
        ['radial_spacing', CODE1],  // 21
        ['elevation_number', INT1],  // 22
        ['cut_sector', INT1],  // 23
        ['elevation_angle', REAL4],  // 24-27
        ['radial_blanking', CODE1],  // 28
        ['azimuth_mode', SINT1],  // 29
        ['block_count', INT2],  // 30-31
        ['block_pointer_1', INT4],  // 32-35  Volume Data Constant XVII-E
        ['block_pointer_2', INT4],  // 36-39  Elevation Data Constant XVII-F
        ['block_pointer_3', INT4],  // 40-43  Radial Data Constant XVII-H
        ['block_pointer_4', INT4],  // 44-47  Moment 'REF' XVII-{B/I}
        ['block_pointer_5', INT4],  // 48-51  Moment 'VEL'
        ['block_pointer_6', INT4],  // 52-55  Moment 'SW'
        ['block_pointer_7', INT4],  // 56-59  Moment 'ZDR'
        ['block_pointer_8', INT4],  // 60-63  Moment 'PHI'
        ['block_pointer_9', INT4],  // 64-67  Moment 'RHO'
        ['block_pointer_10', INT4],  // Moment 'CFP'
    ],


    // Table III Digital Radar Data (Message Type 1)
    // pages 3-7 to
    MSG_1: [
        ['collect_ms', INT4],  // 0-3
        ['collect_date', INT2],  // 4-5
        ['unambig_range', SINT2],  // 6-7
        ['azimuth_angle', CODE2],  // 8-9
        ['azimuth_number', INT2],  // 10-11
        ['radial_status', CODE2],  // 12-13
        ['elevation_angle', INT2],  // 14-15
        ['elevation_number', INT2],  // 16-17
        ['sur_range_first', CODE2],  // 18-19
        ['doppler_range_first', CODE2],  // 20-21
        ['sur_range_step', CODE2],  // 22-23
        ['doppler_range_step', CODE2],  // 24-25
        ['sur_nbins', INT2],  // 26-27
        ['doppler_nbins', INT2],  // 28-29
        ['cut_sector_num', INT2],  // 30-31
        ['calib_const', REAL4],  // 32-35
        ['sur_pointer', INT2],  // 36-37
        ['vel_pointer', INT2],  // 38-39
        ['width_pointer', INT2],  // 40-41
        ['doppler_resolution', CODE2],  // 42-43
        ['vcp', INT2],  // 44-45
        ['spare_1', '8s'],  // 46-53
        ['spare_2', '2s'],  // 54-55
        ['spare_3', '2s'],  // 56-57
        ['spare_4', '2s'],  // 58-59
        ['nyquist_vel', SINT2],  // 60-61
        ['atmos_attenuation', SINT2],  // 62-63
        ['threshold', SINT2],  // 64-65
        ['spot_blank_status', INT2],  // 66-67
        ['spare_5', '32s'],  // 68-99
        // 100+  reflectivity, velocity and/or spectral width data, CODE1
    ],

    // Table XI Volume Coverage Pattern Data (Message Type 5 & 7)
    // pages 3-51 to 3-54
    MSG_5: [
        ['msg_size', INT2],
        ['pattern_type', CODE2],
        ['pattern_number', INT2],
        ['num_cuts', INT2],
        ['clutter_map_group', INT2],
        ['doppler_vel_res', CODE1],  // 2: 0.5 degrees, 4: 1.0 degrees
        ['pulse_width', CODE1],  // 2: short, 4: long
        ['spare', '10s'],  // halfwords 7-11 (10 bytes, 5 halfwords)
    ],

    MSG_5_ELEV: [
        ['elevation_angle', CODE2],  // scaled by 360/65536 for value in degrees.
        ['channel_config', CODE1],
        ['waveform_type', CODE1],
        ['super_resolution', CODE1],
        ['prf_number', INT1],
        ['prf_pulse_count', INT2],
        ['azimuth_rate', CODE2],
        ['ref_thresh', SINT2],
        ['vel_thresh', SINT2],
        ['sw_thresh', SINT2],
        ['zdr_thres', SINT2],
        ['phi_thres', SINT2],
        ['rho_thres', SINT2],
        ['edge_angle_1', CODE2],
        ['dop_prf_num_1', INT2],
        ['dop_prf_pulse_count_1', INT2],
        ['spare_1', '2s'],
        ['edge_angle_2', CODE2],
        ['dop_prf_num_2', INT2],
        ['dop_prf_pulse_count_2', INT2],
        ['spare_2', '2s'],
        ['edge_angle_3', CODE2],
        ['dop_prf_num_3', INT2],
        ['dop_prf_pulse_count_3', INT2],
        ['spare_3', '2s'],
    ],

    // Table XVII-B Data Block (Descriptor of Generic Data Moment Type)
    // pages 3-90 and 3-91
    GENERIC_DATA_BLOCK: [
        ['block_type', '1s'],
        ['data_name', '3s'],  // VEL, REF, SW, RHO, PHI, ZDR
        ['reserved', INT4],
        ['ngates', INT2],
        ['first_gate', SINT2],
        ['gate_spacing', SINT2],
        ['thresh', SINT2],
        ['snr_thres', SINT2],
        ['flags', CODE1],
        ['word_size', INT1],
        ['scale', REAL4],
        ['offset', REAL4],
        // then data
    ],

    // Table XVII-E Data Block (Volume Data Constant Type)
    // page 3-92
    VOLUME_DATA_BLOCK: [
        ['block_type', '1s'],
        ['data_name', '3s'],
        ['lrtup', INT2],
        ['version_major', INT1],
        ['version_minor', INT1],
        ['lat', REAL4],
        ['lon', REAL4],
        ['height', SINT2],
        ['feedhorn_height', INT2],
        ['refl_calib', REAL4],
        ['power_h', REAL4],
        ['power_v', REAL4],
        ['diff_refl_calib', REAL4],
        ['init_phase', REAL4],
        ['vcp', INT2],
        ['spare', '2s'],
    ],

    // Table XVII-F Data Block (Elevation Data Constant Type)
    // page 3-93
    ELEVATION_DATA_BLOCK: [
        ['block_type', '1s'],
        ['data_name', '3s'],
        ['lrtup', INT2],
        ['atmos', SINT2],
        ['refl_calib', REAL4],
    ],

    // Table XVII-H Data Block (Radial Data Constant Type)
    // pages 3-93
    RADIAL_DATA_BLOCK: [
        ['block_type', '1s'],
        ['data_name', '3s'],
        ['lrtup', INT2],
        ['unambig_range', SINT2],
        ['noise_h', REAL4],
        ['noise_v', REAL4],
        ['nyquist_vel', SINT2],
        ['spare', '2s'],
    ],
}

module.exports = level2_constants;
},{}],8:[function(require,module,exports){
const get_nexrad_location = require('../nexrad_locations').get_nexrad_location;
const calculate_coordinates = require('../../plot/calculate_coordinates');
const display_file_info = require('../../libnexrad_helpers/display_file_info');
const elevation_menu = require('../../libnexrad_helpers/level2/elevation_menu');
const dealias = require('../../libnexrad_helpers/level2/dealias/dealias');
const map = require('../../../core/map/map');
const plot_to_map = require('../../plot/plot_to_map');
const work = require('webworkify');

// https://stackoverflow.com/a/8043061
function _zero_pad(num) {
    const formatted_number = num.toLocaleString('en-US', {
        minimumIntegerDigits: 2,
        useGrouping: false
    })
    return formatted_number;
}

/**
 * A class that provides simple access to the radar data returned from the 'NEXRADLevel2File' class.
 * It sorts the radar sweeps by elevation, and provides several functions that assist with retrieving specific bits of data.
 */
class Level2Factory {
    constructor (initial_radar_obj) {
        this.initial_radar_obj = initial_radar_obj;

        this.nexrad_level = 2;
        this.filename = initial_radar_obj.filename;

        this.header = initial_radar_obj.volume_header;
        this.vcp = initial_radar_obj.vcp;
        this.nscans = this.initial_radar_obj.nscans;
        this.vcp = this.get_vcp();

        this.dealias_data = {};
        this._wasm_loaded = false;

        this.station = this.header.icao;
        const station_remove_irregular = this.station.replaceAll('\u0000', '').trim();
        if (station_remove_irregular == '') {
            const station_from_filename = this.filename.substring(0, 4);
            this.station = station_from_filename;
            this.header.icao = station_from_filename;
        }

        this._group_and_sort_sweeps();
        this.elevation_angle = this.get_elevation_angle(1);
        this.elevation_number = 1;
    }

    /**
     * Get the gate values for a given moment and elevation number.
     * 
     * @param {*} moment The moment being requested. Can be one of the following: 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @param {Boolean} retrieve_dealiased Whether or not to return the dealiased data.
     * @returns {Array} A 2D array, with each sub-array being an array of its corresponding radial's data.
     */
    get_data(moment, elevation_number, retrieve_dealiased) {
        var key = 'data';
        if (retrieve_dealiased == undefined) { retrieve_dealiased = false }
        if (retrieve_dealiased) { key = 'dealiased_data' }
        var data = this.get_value_from_sweep(key, moment, elevation_number);
        if (retrieve_dealiased) {
            return data;
        }

        var prod_hdr = this.grouped_sweeps[elevation_number][0][moment];
        var offset = prod_hdr.offset;
        var scale = prod_hdr.scale;

        var scaleFunction = function(x) {
            if (x <= 1) { return null; }
            else { return (x - offset) / scale; }
        };
        data = this._scale_values(data, scaleFunction);

        return data;
    }

    /**
     * Get the azimuth angles for a given moment and elevation number.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Array} An array, containing all of the azimuth angles for each radial in the sweep.
     */
    get_azimuth_angles(elevation_number) {
        var azimuths = this.get_value_from_sweep('azimuth_angle', 'msg_header', elevation_number);

        var msg_type = this.initial_radar_obj.msg_type;
        var scale;
        if (msg_type == '1') {
            scale = 180 / (4096 * 8);
        } else {
            scale = 1;
        }

        var scaleFunction = function(x) { return x * scale; };
        azimuths = this._scale_values(azimuths, scaleFunction);

        // adjust the azimuth values
        azimuths = this._adjust_azimuths(azimuths);
        return azimuths;
    }

    /**
     * Get the ranges (distances) from the radar, for each gate along a radial at any azimuth.
     * 
     * @param {*} moment The moment being requested. Can be one of the following: 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Array} An array, containing all of the ranges for any azimuth in the sweep.
     */
    get_ranges(moment, elevation_number) {
        var prod_hdr = this.grouped_sweeps[elevation_number][0][moment];
        var gate_count = prod_hdr.ngates;
        var gate_size = prod_hdr.gate_spacing / 1000;
        var first_gate = prod_hdr.first_gate / 1000;
        // level 2 = 1832 0.25 2.125
        var prod_range = [...Array(gate_count + 1).keys()];
        for (var i in prod_range) {
            prod_range[i] = (prod_range[i] - 0.5) * gate_size + first_gate;
        }
        return prod_range;
    }

    /**
     * Gets a specific value in a moment for each radial in a sweep. This can be useful when gathering data that varies across all radials.
     * 
     * @param {String} key The key to look for in the requested moment's object.
     * @param {String} moment The moment being requested. Can be one of the following: 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP', 'ELV', 'RAD', 'VOL', 'header', 'msg_header'
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Array} An array, containing the requested values for each radial in a sweep.
     */
    get_value_from_sweep(key, moment, elevation_number) {
        var output = [];
        var curSweep = this.grouped_sweeps[elevation_number];
        for (var i in curSweep) {
            var curRecord = curSweep[i];
            if (curRecord.hasOwnProperty(moment)) {
                var data = curRecord[moment][key];
                if (key == 'data') {
                    data = Array.from(data);
                }
                output.push(data);
            }
        }
        return output;
    }

    /**
     * Retrieves the radar's coordinates and altitude, by first searching a radial record, and if that fails, by looking up the radar's ICAO.
     * 
     * @param {String} station (optional) The four-letter ICAO of a radar station. If passed, the function will return the coordinates of that station.
     * This is useful for older AR2V files where the location data is not included.
     * @returns {Array} An array in the format [latitude, longitude, altitude (in meters)]. Will return [0, 0, 0] if the radar's location could not be determined.
     */
    get_location(station = null) {
        var lat, lng, alt;

        if (station != null) {
            [lat, lng, alt] = get_nexrad_location(station);
            return [lat, lng, alt];
        }
        var msg_type = this.initial_radar_obj.msg_type;
        if (msg_type == '1') {
            if (this.header.hasOwnProperty('icao')) {
                [lat, lng, alt] = get_nexrad_location(this.header['icao']);
            } else {
                return [0, 0, 0];
            }
        } else {
            if (this.initial_radar_obj.radial_records[0].hasOwnProperty('VOL')) {
                var dic = this.initial_radar_obj.radial_records[0]['VOL'];
                var height = dic['height'] + dic['feedhorn_height'];
                [lat, lng, alt] = [dic['lat'], dic['lon'], height];
            } else if (this.header.hasOwnProperty('icao')) {
                [lat, lng, alt] = get_nexrad_location(this.header['icao']);
            } else {
                return [0, 0, 0];
            }
        }

        return [lat, lng, alt];
    }

    /**
     * Scales an elevation angle value by the standard set in the ICD.
     * 
     * @param {Number} elevation_angle The unscaled elevation number.
     */
    _scale_elevation_angle(elevation_angle) {
        var scaled_elev_angle = elevation_angle * (180 / (4096 * 8));
        if (scaled_elev_angle >= 50) {
            scaled_elev_angle = scaled_elev_angle - 360;
        }
        return scaled_elev_angle;
    }
    /**
     * Get the elevation angle for a given elevation number.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     */
    get_elevation_angle(elevation_number) {
        var msg_type = this.initial_radar_obj.msg_type;
        var elev_angle;
        if (msg_type == '1') {
            elev_angle = this.get_value_from_sweep('elevation_angle', 'msg_header', elevation_number)[0];
        } else {
            elev_angle = this.initial_radar_obj.vcp.cut_parameters[elevation_number - 1].elevation_angle;
        }

        return this._scale_elevation_angle(elev_angle);
    }

    /**
     * Gets the date at which the radar volume was collected.
     * If an elevation number is passed, the date for that sweep is returned.
     * If nothing is passed, the date for the whole volume is returned.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Date} A Date object that contains the radar volume's time.
     */
    get_date(elevation_number = null) {
        var modifiedJulianDate, milliseconds;

        if (elevation_number == null) {
            modifiedJulianDate = this.header.date;
            milliseconds = this.header.time;
        } else {
            // the date & time for the first radial in a sweep. each radial has its own date,
            // but we'll only use the first one, representing the start of the sweep.
            var sweepHeader = this.grouped_sweeps[elevation_number][0].header;
            modifiedJulianDate = sweepHeader.date;
            milliseconds = sweepHeader.ms;
        }

        if (this.station == 'KULM' || this.station == 'WILU' || this.station == 'FWLX') {
            modifiedJulianDate = this.grouped_sweeps[1][0].header.date;
        }

        return this._julian_and_millis_to_date(modifiedJulianDate, milliseconds);
    }

    /**
     * Finds the numerical VCP (volume coverage pattern) of the radar file. Returns 'null' if it could not be found.
     * 
     * @returns {Number} The VCP of the radar file.
     */
    get_vcp() {
        var volMomentVCP = this?.initial_radar_obj?.radial_records?.[0]?.['VOL']?.vcp;
        var msg_headerMomentVCP = this?.initial_radar_obj?.radial_records?.[0]?.['msg_header']?.vcp;
        var headerVCP = this?.vcp?.['msg5_header']?.['pattern_number'];

        if (headerVCP == 0) {
            return volMomentVCP ??
                msg_headerMomentVCP ??
                null;
        } else {
            return headerVCP ??
                volMomentVCP ??
                msg_headerMomentVCP ??
                null;
        }
    }

    /**
     * Function that plots the factory with its radar data to the map.
     * 
     * @param {*} moment The moment being requested. Can be one of the following: 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     */
    plot(moment, elevation_number) {
        this.elevation_angle = this.get_elevation_angle(elevation_number);
        this.elevation_number = elevation_number;

        // we don't want to load the elevation menu multiple times for the same radar file
        const file_id = this.generate_unique_id();
        if (window.vortexData.L2_file_id != file_id) { // if we're on a new file
            window.vortexData.L2_file_id = file_id; // set the new id globally
            elevation_menu.apply(this, [this.list_elevations_and_products()]); // load the elevation menu
        }

        this.display_file_info();
        const options = {'product': moment, 'elevation': elevation_number};

        window.vortexData.nexrad_factory_moment = moment
        window.vortexData.nexrad_factory_elevation_number = elevation_number;
        window.vortexData.nexrad_factory = this;

        /* Remember which radar is on screen, for the Graphics Studio.
         *
         * The studio decodes Level 2 itself and needs to know which site the
         * viewer is actually looking at, so a graphic is built from the same
         * radar as the map they just came from instead of whichever station
         * happens to sit nearest the studio's default view. Same idea as the
         * colortable pick, which is already recorded this way.
         *
         * Write-only and fully guarded: private-mode browsers throw on
         * localStorage, and nothing on this page reads it back, so a failure
         * here must never interrupt a plot. */
        try {
            // The station comes out of a fixed-width header field, so strip
            // anything that is not a letter rather than trusting it to be clean.
            const st = String(this.station || '').toUpperCase().replace(/[^A-Z]/g, '');
            if (/^[A-Z]{3,4}$/.test(st)) {
                // Position too, so the studio can open framed on this radar
                // without waiting on an async station-table lookup first.
                const loc = this.get_location();
                const record = { site: st, at: Date.now() };
                if (loc && isFinite(loc[0]) && isFinite(loc[1])) {
                    record.lat = loc[0];
                    record.lon = loc[1];
                }
                localStorage.setItem('vortexCurrentRadarSite', JSON.stringify(record));
            }
        } catch (e) { /* storage unavailable — the studio just falls back */ }

        calculate_coordinates(this, options);
    }

    /**
     * Function that writes the necessary file information to the DOM.
     */
    display_file_info() {
        // execute code from another file
        display_file_info.apply(this);
    }

    /**
     * Function that loops over every sweep, and stores information about the sweep in an array.
     * This is useful for creating buttons in the DOM. Often abbreviated "lEAP".
     * 
     * @returns {Array} An array with sorted information about each sweep. Formatted as such:
     * [elevation angle, elevation number, moments in the elevation, waveform type]
     */
    list_elevations_and_products() {
        var elevation_angle;
		var elev_angle_arr = [];
        if (this.initial_radar_obj.msg_type == '31') {
            for (var key = 0; key < this.initial_radar_obj.vcp.cut_parameters.length; key++) {
                try {
                    var elevations_base = this.initial_radar_obj.vcp.cut_parameters[key];
                    var product_base = this.grouped_sweeps[key + 1][0];

                    var all_products_arr = [];
                    ['REF', 'VEL', 'RHO', 'PHI', 'ZDR', 'SW'].forEach(prop => {
                        if (product_base.hasOwnProperty(prop)) {
                            all_products_arr.push(prop);
                        }
                    });

                    elevation_angle = this._scale_elevation_angle(elevations_base.elevation_angle);
                    elev_angle_arr.push([
                        elevation_angle,
                        (key + 1).toString(),
                        all_products_arr,
                        elevations_base.waveform_type
                    ]);
                } catch (e) {
                    console.warn(`Warning on elevation ${elevation_angle}: ${e}`);
                }
            }
        } else if (this.initial_radar_obj.msg_type == '1') {
            for (var key = 1; key < this.grouped_sweeps.length; key++) {
                try {
                    var elevations_base = this.grouped_sweeps[key][0].msg_header;
                    var product_base = this.grouped_sweeps[key][0];

                    var all_products_arr = [];
                    ['REF', 'VEL', 'RHO', 'PHI', 'ZDR', 'SW'].forEach(prop => {
                        if (product_base.hasOwnProperty(prop)) {
                            all_products_arr.push(prop);
                        }
                    });

                    elevation_angle = this._scale_elevation_angle(elevations_base.elevation_angle);
                    elev_angle_arr.push([
                        elevation_angle,
                        key.toString(),
                        all_products_arr,
                        null
                    ]);
                } catch (e) {
                    console.warn(`Warning on elevation ${elevation_angle}: ${e}`);
                }
            }
        }
        return elev_angle_arr;
    }

    /**
     * Function that returns an array with the product abbreviations of all of the products contained in the radar file
     * 
     * @returns {Array} An array with all of the radar file's moments
     */
	get_all_products() {
		var lEAP = this.list_elevations_and_products();

		var all_products = [];
		for (var i in lEAP) {
			var products = lEAP[i][2];
			for (var n in products) {
				if (!all_products.includes(products[n])) {
					all_products.push(products[n]);
				}
			}
		}

		return all_products;
	}

    /**
     * Generates a unique ID associated with the file.
     * 
     * @returns {String} A string with the file's ID.
     */
    generate_unique_id() {
        const station = this.station;
        const date = this.get_date();
        const year = date.getUTCFullYear();
        const month = _zero_pad(date.getUTCMonth() + 1);
        const day = _zero_pad(date.getUTCDate());
        const hour = _zero_pad(date.getUTCHours());
        const minute = _zero_pad(date.getUTCMinutes());
        const second = _zero_pad(date.getUTCSeconds());

        const formatted_string = `${station}${year}${month}${day}_${hour}${minute}${second}`;
        return formatted_string;
    }

    /**
     * Zooms and pans the map to the radar's location.
     */
    fly_to_location() {
        const location = this.get_location();
        map.flyTo({ center: [location[1], location[0]], zoom: 6.5, speed: 1.75, essential: true });
    }

    /**
     * Returns the nyquist velocity for a given sweep.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Number} The nyquist velocity.
     */
    get_nyquist_vel(elevation_number) {
        var nyquist; 
        if (this.initial_radar_obj.msg_type == '31') {
            nyquist = this.grouped_sweeps[elevation_number][0].RAD.nyquist_vel;
        } else if (this.initial_radar_obj.msg_type == '1') {
            nyquist = this.grouped_sweeps[elevation_number][0].msg_header.nyquist_vel;
        }
        return nyquist / 100;
    }

    /**
     * Dealiases the velocity data for a given sweep.
     * The data is outputted to the "dealiased_data" key for the "VEL" moment in the sweep.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     */
    dealias(elevation_number) {
        const nyquist = this.get_nyquist_vel(elevation_number);
        const velocities = this.get_data('VEL', elevation_number);
        const dealiased_velocities = dealias(velocities, nyquist);

        for (var i = 0; i < this.grouped_sweeps[elevation_number].length; i++) {
            this.grouped_sweeps[elevation_number][i].VEL.dealiased_data = dealiased_velocities[i];
        }
    }

    /**
     * Checks whether or not a given sweep has been dealiased yet.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @returns {Boolean} Whether or not the sweep has been dealiased yet.
     */
    check_if_already_dealiased(elevation_number) {
        if (this.grouped_sweeps[elevation_number][0]?.VEL?.dealiased_data == undefined) {
            // we HAVEN'T dealiased yet
            return false;
        } else {
            // we HAVE dealiased
            return true;
        }
    }

    /**
     * Dealiases a radar sweep using an algorithm that works well on tornadic signatures.
     * It automatically plots the dealiased data to the map.
     * 
     * @param {Number} elevation_number A number that represents the elevation's index from the base sweep. Indices start at 1.
     * @param {Function} callback A callback function to execute after the map plotting has completed.
     */
    dealias_alt_and_plot(elevation_number, callback) {
        const thisobj = this;

        const already_dealiased = this.dealias_data[elevation_number];
        if (already_dealiased != undefined) {
            plot_to_map(new Float32Array(already_dealiased.points), new Float32Array(already_dealiased.values), 'VEL', this);
            callback();
        } else {
            const buffer = this.initial_radar_obj.buffer.slice(0); // copy the buffer

            if (this._wasm_worker == undefined) {
                const worker = new Worker('./app/radar/libnexrad/level2/wasm/dealias_worker.js');
                this._wasm_worker = worker;
            }

            function _init() {
                thisobj._wasm_loaded = true;
                thisobj._wasm_worker.postMessage({ message: "checkExists", name: thisobj.generate_unique_id()});
            }

            if (this._wasm_loaded) {
                _init();
            }

            thisobj._wasm_worker.onmessage = (event) => {
                // console.log(event.data);

                if (event.data == 'loaded') {
                    _init();
                }

                if (event.data.action == 'doesExist') {
                    // thisobj._wasm_worker.postMessage({ message: "deleteFile", fileNum: 0 });
                    thisobj._wasm_worker.postMessage({ message: "dealiasVelocity", data: { fileNum: 0, idx: elevation_number, field: 255 } });
                }
                if (event.data.action == 'doesNotExist') {
                    thisobj._wasm_worker.postMessage({ message: "initialize", fileName: thisobj.generate_unique_id(), buffer: buffer }, [buffer]);
                    thisobj._wasm_worker.postMessage({ message: "dealiasVelocity", data: { fileNum: 0, idx: elevation_number, field: 255 } });
                }

                if (event.data.action == 'loadDataDealias') {
                    const f32 = event.data.data.float;
                    const array = Array.from(f32);

                    const location = thisobj.get_location();

                    const values = [];
                    var points = [];
                    for (var i = 0; i < array.length; i += 3) {
                        const x = array[i];
                        const y = array[i + 1];

                        points.push(x);
                        points.push(y);
                        values.push(array[i + 2] / 1.944);
                    }
                    points = new Float32Array(points);

                    var w = work(require('./wasm/correction_worker'));
                    w.addEventListener('message', function (ev) {
                        if (thisobj.dealias_data[elevation_number] == undefined) {
                            thisobj.dealias_data[elevation_number] = { points: ev.data, values: values }
                        }

                        plot_to_map(ev.data, new Float32Array(values), 'VEL', thisobj);
                        callback();
                    })
                    w.postMessage([points, location], [points.buffer]);
                }
            }
        }
    }

    /**
     * Helper function that converts a modified julian date (MJD) and milliseconds to a JavaScript Date object.
     * 
     * @param {Number} modifiedJulianDate A Number representing the modified julian date.
     * @param {Number} milliseconds A Number representing the number of milliseconds.
     * e.g. 0 ms = 00:00 UTC, 82800000 ms == 23:00 UTC
     * @returns {Date} The two input values converted to a Date object.
     */
    _julian_and_millis_to_date(modifiedJulianDate, milliseconds) {
        // page 14 - https://www.roc.noaa.gov/wsr88d/PublicDocs/ICDs/2620001Y.pdf
        // page 16 - https://www.roc.noaa.gov/wsr88d/PublicDocs/ICDs/2620002U.pdf
        var julianDate = modifiedJulianDate + 2440586.5;
        // https://stackoverflow.com/a/36073807
        var millis = (julianDate - 2440587.5) * 86400000;

        var fileDateObj = new Date(millis);
        var fileHours = msToTime(milliseconds).hours;
        var fileMinutes = msToTime(milliseconds).minutes;
        var fileSeconds = msToTime(milliseconds).seconds;
        fileDateObj.setUTCHours(fileHours);
        fileDateObj.setUTCMinutes(fileMinutes);
        fileDateObj.setUTCSeconds(fileSeconds);

        return fileDateObj;
    }

    /**
     * Helper function that scales all of the values in an input array to the desired size. This is useful when converting NEXRAD binary data from its stored format to its readable format, as defined in the ICD.
     * 
     * @param {*} inputValues A 1D or 2D array containing values you wish to scale.
     * @param {Function} scaleFunction The function to perform on every value. For example, passing 'function(x) { return x * 2 }' will double each element in the array.
     * @returns {Array} An array in the same shape as the original, but with the values scaled.
     */
    _scale_values(inputValues, scaleFunction) {
        for (var i in inputValues) {
            if (Array.isArray(inputValues[i])) { // this check allows for the scaling of 2D arrays
                inputValues[i] = inputValues[i].map(i => scaleFunction(i)); // perform the scaling function on every sub-element
            } else {
                inputValues[i] = scaleFunction(inputValues[i]);
            }
        }
        return inputValues;
    }

    /**
     * Helper function that performs some adjustments on the azimuth values.
     * Taken from the example at:
     * https://unidata.github.io/MetPy/latest/examples/formats/NEXRAD_Level_2_File.html
     * 
     * @param {Array} azimuths An array of azimuth values to adjust.
     * @returns {Array} An array with the corrected azimuth values.
     */
    _adjust_azimuths(azimuths) {
        var diff = azimuths.slice(1).map((val, index) => val - azimuths[index]);
        var crossed = diff.map(i => i < -180);
        diff = diff.map((val, index) => crossed[index] ? val + 360 : val);
        var avg_spacing = diff.reduce((a, b) => a + b) / diff.length;

        // Convert mid-point to edge
        azimuths = azimuths.slice(0, -1).map((val, index) => (val + azimuths[index + 1]) / 2);
        azimuths = azimuths.map((val, index) => crossed[index] ? val + 180 : val);

        // Concatenate with overall start and end of data we calculate using the average spacing
        azimuths = [azimuths[0] - avg_spacing].concat(azimuths, [azimuths[azimuths.length - 1] + avg_spacing]);
        return azimuths;
    }

    /**
     * Helper function that groups all of the
     * radial records found in the file by their elevation number.
     * 
     * Creates a new array in the Level2Factory class called 'grouped_sweeps'.
     */
    _group_and_sort_sweeps() {
        var grouped = [];
        var scan_msgs = this.initial_radar_obj.scan_msgs; // the 2d array that stores the index of each radial record for each elevation
        var radial_records = this.initial_radar_obj.radial_records; // the array that stores all radial records from the file
        for (var i = 0; i < scan_msgs.length; i++) { // loop through all of the scan messages indices
            var curElevNum = i + 1; // elevation numbers are 1-based, while JS array indices are 0-based
            var curSweep = scan_msgs[i]; // pull the scan messages for the current sweep
            for (var n in curSweep) { // loop through the current sweep's scan messages (a 1d array of indices)
                var radialRecordNumber = curSweep[n]; // the current scan message index
                var cur_radial_record = radial_records[radialRecordNumber]; // pull the relevant radial record pertaining to the current scan message index

                if (grouped[curElevNum] == undefined) { // create a sub-array in the output array if it doesn't exist
                    grouped[curElevNum] = [];
                }
                grouped[curElevNum].push(cur_radial_record); // push the current radial record to its correct position
            }
        }
        this.grouped_sweeps = grouped;
    }
}

function msToTime(s) {
    // Pad to 2 or 3 digits, default is 2
    function pad(n, z) {
        z = z || 2;
        return ('00' + n).slice(-z);
    }
    var ms = s % 1000;
    s = (s - ms) / 1000;
    var secs = s % 60;
    s = (s - secs) / 60;
    var mins = s % 60;
    var hrs = (s - mins) / 60;
    return {
        'hours': pad(hrs),
        'minutes': pad(mins),
        'seconds': pad(secs),
        'milliseconds': pad(ms, 3),
    }
    // return pad(hrs) + ':' + pad(mins) + ':' + pad(secs) + '.' + pad(ms, 3);
}

module.exports = Level2Factory;
},{"../../../core/map/map":23,"../../libnexrad_helpers/display_file_info":23,"../../libnexrad_helpers/level2/dealias/dealias":23,"../../libnexrad_helpers/level2/elevation_menu":23,"../../plot/calculate_coordinates":23,"../../plot/plot_to_map":23,"../nexrad_locations":11,"./wasm/correction_worker":10,"webworkify":50}],9:[function(require,module,exports){
(function (Buffer){(function (){
// const fs = require('fs');
// https://github.com/cscott/seek-bzip
const bzip = require('seek-bzip');
const compressjs = require('../../../../lib/compressjs/main');
const pako = require('pako');
const BufferPack = require('bufferpack');
const RandomAccessFile = require('../buffer_tools/RandomAccessFile');
const get_nexrad_location = require('../nexrad_locations').get_nexrad_location;
const level2_constants = require('./level2_constants');
const progress_bar = require('../../../core/misc/progress_bar');

const work = require('webworkify');
const decompress_worker = require('./decompress_worker');

function _arraysEqual(arr1, arr2) {
    return JSON.stringify(arr1) == JSON.stringify(arr2);
}

function min(arr) { return Math.min(...[...new Set(arr)]) }
function max(arr) { return Math.max(...[...new Set(arr)]) }

/**
 * Check if the file is gzip compressed.
 * If it is, return the decompressed RAF.
 * If not, return the original RAF.
 */
function _decompressFile(fh) {
    var magic = fh.peek(3);
    magic = Array.from(magic);
    if (_arraysEqual(magic, [31, 139, 8])) {
        // console.log('GZIP compressed.');
        var inflated = pako.inflate(fh.buffer);
        return new RandomAccessFile(Buffer.from(inflated));
    } else {
        return fh;
    }
}

function _bufferToString(buffer) {
    return new TextDecoder('UTF-8').decode(buffer);
}

function _handle_compression(fh, compression_or_ctm_info, callback) {
    var buf;
    if (_bufferToString(compression_or_ctm_info) == 'BZ') {
        progress_bar.show_progress_bar();
        // buf = _decompress_records(fh);
        const w = work(decompress_worker);
        w.addEventListener('message', function (ev) {
            if (ev.data.message == 'finish') {
                buf = ev.data.data;
                callback(buf);
                progress_bar.hide_progress_bar();
            } else if (ev.data.message == 'progress') {
                const percent = ev.data.data;
                progress_bar.set_progress_bar_width(percent);
                progress_bar.set_progress_bar_text(`Loading... ${percent}%`);
            }
        })
        w.postMessage(fh.buffer/*, [fh.buffer]*/);
    } else if (_arraysEqual(new Uint8Array(compression_or_ctm_info), new Uint8Array([0x00, 0x00])) || _arraysEqual(new Uint8Array(compression_or_ctm_info), new Uint8Array([0x09, 0x80]))) {
        buf = fh.read();
        callback(buf);
    } else {
        console.error('Unknown compression record.');
        buf = fh.read();
        callback(buf);
    }
}

class NEXRADLevel2File {
    constructor (fileBuffer, callback, filename) {
        console.log('Start');
        var fh = new RandomAccessFile(fileBuffer);
        fh = _decompressFile(fh);

        this.buffer = fh.buffer.buffer;

        this.filename = filename;

        this.nexradLevel = 2;

        var size = _structure_size(level2_constants.VOLUME_HEADER);
        this.volume_header = _unpack_structure(fh.read(size), level2_constants.VOLUME_HEADER);
        var compression_record = fh.read(level2_constants.COMPRESSION_RECORD_SIZE);

        // read the records in the file, decompressing as needed
        var compression_or_ctm_info = compression_record.slice(level2_constants.CONTROL_WORD_SIZE, level2_constants.CONTROL_WORD_SIZE + 2);

        console.log('Start decompression');
        _handle_compression(fh, compression_or_ctm_info, (buf) => {
            console.log('End decompression');
            this._fh = fh;

            // read the records from the buffer
            this._records = [];
            var buf_length = buf.length;
            var pos = 0;
            while (pos < buf_length) {
                var record = _get_record_from_buf(buf, pos);
                pos = record[0];
                var dic = record[1];
                this._records.push(dic);
            }

            // pull out radial records (1 or 31) which contain the moment data.
            this.radial_records = this._records.filter(r => r['header']['type'] == 31);
            this.msg_type = '31';
            if (this.radial_records.length == 0) {
                this.radial_records = this._records.filter(r => r['header']['type'] == 1);
                this.msg_type = '1';
            }
            if (this.radial_records.length == 0) {
                console.error('No MSG31 records found, cannot read file');
            }
            var elev_nums = this.radial_records.map(m => m['msg_header']['elevation_number']);
            this.scan_msgs = Array.from({ length: Math.max(...elev_nums) }, (_, i) => {
                return elev_nums.reduce((acc, val, idx) => {
                    if (val === i + 1) acc.push(idx);
                    return acc;
                }, []);
            });
            this.nscans = this.scan_msgs.length;

            // pull out the vcp record
            var msg_5 = this._records.filter(r => r['header']['type'] == 5);

            if (msg_5.length) {
                this.vcp = msg_5[0];
            } else {
                // There is no VCP Data.. This is uber dodgy
                this.vcp = null;

                console.error(`No MSG5 detected. Setting to meaningless data. Rethink your life choices and be ready for errors. Specifically fixed angle data will be missing`);
            }

            callback(this);
            // return;
        })
    }
    location(station = null) {
        /*
        Find the location of the radar.

        Returns all zeros if location is not available.

        Returns
        -------
        latitude : float
            Latitude of the radar in degrees.
        longitude : float
            Longitude of the radar in degrees.
        height : int
            Height of radar and feedhorn in meters above mean sea level.
        */

        var lat, lon, alt;
        if (this.msg_type == '1' && station != null) {
            [lat, lon, alt] = get_nexrad_location(station);
        } else if (
            this.volume_header.hasOwnProperty('icao') &&
            this.msg_type == '1'
        ) {
            [lat, lon, alt] = get_nexrad_location(this.volume_header['icao']);
        } else if (this.radial_records[0].hasOwnProperty('VOL')) {
            var dic = this.radial_records[0]['VOL'];
            var height = dic['height'] + dic['feedhorn_height'];
            [lat, lon, alt] = [dic['lat'], dic['lon'], height];
        } else {
            return [0.0, 0.0, 0.0];
        }
        return [lat, lon, alt];
    }
    scan_info(scans = null) {
        /*
        Return a list of dictionaries with scan information.

        Parameters
        ----------
        scans : list ot None
            Scans (0 based) for which ray (radial) azimuth angles will be
            retrieved.  None (the default) will return the angles for all
            scans in the volume.

        Returns
        -------
        scan_info : list, optional
            A list of the scan performed with a dictionary with keys
            'moments', 'ngates', 'nrays', 'first_gate' and 'gate_spacing'
            for each scan.  The 'moments', 'ngates', 'first_gate', and
            'gate_spacing' keys are lists of the NEXRAD moments and gate
            information for that moment collected during the specific scan.
            The 'nrays' key provides the number of radials collected in the
            given scan.
        */

        let info = [];

        if (scans === null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        for (var scan of scans) {
            var nrays = this.get_nrays(scan);
            if (nrays < 2) {
                this.nscans -= 1;
                continue;
            }
            var msg31_number = this.scan_msgs[scan][0];
            var msg = this.radial_records[msg31_number];
            var nexrad_moments = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'];
            var moments = nexrad_moments.filter(f => f in msg);
            var ngates = moments.map(f => msg[f]['ngates']);
            var gate_spacing = moments.map(f => msg[f]['gate_spacing']);
            var first_gate = moments.map(f => msg[f]['first_gate']);
            info.push({
                'nrays': nrays,
                'ngates': ngates,
                'gate_spacing': gate_spacing,
                'first_gate': first_gate,
                'moments': moments
            });
        }
        return info;
    }
    get_vcp_pattern() {
        /*
        Return the numerical volume coverage pattern (VCP) or None if unknown.
        */
        if (this.vcp == null) {
            return null;
        } else {
            return this.vcp['msg5_header']['pattern_number'];
        }
    }
    get_nrays(scan) {
        /*
        Return the number of rays in a given scan.

        Parameters
        ----------
        scan : int
            Scan of interest (0 based).

        Returns
        -------
        nrays : int
            Number of rays (radials) in the scan.
        */

        return this.scan_msgs[scan].length;
    }
    get_ngates(scan_num, moment) {
        // obj = this.scan_info([scan])[0]
        // moment_index = obj['moments'].index(moment)
        // return obj['ngates'][moment_index]
        var dic = this.radial_records[this.scan_msgs[scan_num][0]][moment];
        var ngates = dic['ngates'];
        return ngates;
    }
    get_range(scan_num, moment) {
        /*
        Return an array of gate ranges for a given scan and moment.

        Parameters
        ----------
        scan_num : int
            Scan number (0 based).
        moment : 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', or 'CFP'
            Moment of interest.

        Returns
        -------
        range : ndarray
            Range in meters from the antenna to the center of gate (bin).
        */

        var dic = this.radial_records[this.scan_msgs[scan_num][0]][moment];
        var ngates = dic['ngates'];
        var first_gate = dic['first_gate'];
        var gate_spacing = dic['gate_spacing'];
        return Array.from({ length: ngates }, (_, i) => i * gate_spacing + first_gate);
    }
    // helper functions for looping over scans
    _msg_nums(scans) {
        /* Find the all message number for a list of scans. */
        return scans.flatMap(i => this.scan_msgs[i]);
    }
    _radial_array(scans, key) {
        /* Return an array of radial header elements for all rays in scans. */
        var msg_nums = this._msg_nums(scans);
        var temp = msg_nums.map(i => this.radial_records[i]['msg_header'][key]);
        return temp;
    }
    _radial_sub_array(scans, key) {
        /* Return an array of RAD or msg_header elements for all rays in scans. */
        var msg_nums = this._msg_nums(scans);
        var tmp;
        if (this.msg_type == '31') {
            tmp = msg_nums.map(i => this.radial_records[i]['RAD'][key]);
        } else {
            tmp = msg_nums.map(i => this.radial_records[i]['msg_header'][key]);
        }
        return tmp;
    }
    get_times(scans = null) {
        /*
        Retrieve the times at which the rays were collected.

        Parameters
        ----------
        scans : list or None
            Scans (0-based) to retrieve ray (radial) collection times from.
            None (the default) will return the times for all scans in the
            volume.

        Returns
        -------
        time_start : Datetime
            Initial time.
        time : ndarray
            Offset in seconds from the initial time at which the rays
            in the requested scans were collected.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        var days = this._radial_array(scans, 'collect_date');
        var secs = this._radial_array(scans, 'collect_ms').map(ms => ms / 1000.0);
        var offset = new Date((parseInt(days[0]) - 1) * 86400000 + parseInt(secs[0]) * 1000);
        var time_start = new Date(offset.getTime());
        var time = secs.map((sec, index) => {
            return sec - parseInt(secs[0]) + (parseInt(days[index]) - parseInt(days[0])) * 86400;
        });
        return [time_start, time];
    }
    get_azimuth_angles(scans = null) {
        /*
        Retrieve the azimuth angles of all rays in the requested scans.

        Parameters
        ----------
        scans : list ot None
            Scans (0 based) for which ray (radial) azimuth angles will be
            retrieved. None (the default) will return the angles for all
            scans in the volume.

        Returns
        -------
        angles : ndarray
            Azimuth angles in degress for all rays in the requested scans.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        var scale;
        if (this.msg_type == '1') {
            scale = 180 / (4096 * 8.0);
        } else {
            scale = 1.0;
        }
        return this._radial_array(scans, 'azimuth_angle').map(i => i * scale);
    }
    get_elevation_angles(scans = null) {
        /*
        Retrieve the elevation angles of all rays in the requested scans.

        Parameters
        ----------
        scans : list or None
            Scans (0 based) for which ray (radial) azimuth angles will be
            retrieved. None (the default) will return the angles for
            all scans in the volume.

        Returns
        -------
        angles : ndarray
            Elevation angles in degress for all rays in the requested scans.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        var scale;
        if (this.msg_type == '1') {
            scale = 180 / (4096 * 8.0);
        } else {
            scale = 1.0;
        }
        return this._radial_array(scans, 'elevation_angle').map(i => i * scale);
    }
    get_target_angles(scans = null) {
        /*
        Retrieve the target elevation angle of the requested scans.

        Parameters
        ----------
        scans : list or None
            Scans (0 based) for which the target elevation angles will be
            retrieved. None (the default) will return the angles for all
            scans in the volume.

        Returns
        -------
        angles : ndarray
            Target elevation angles in degress for the requested scans.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        if (this.msg_type == '31') {
            var cut_parameters;
            if (this.vcp != null) {
                cut_parameters = this.vcp['cut_parameters'];
            }
            var scale = 360.0 / 65536.0;
            return scans.map(i => cut_parameters[i]['elevation_angle'] * scale);
        } else {
            var scale = 180 / (4096 * 8.0);
            var msgs = scans.map(i => this.radial_records[this.scan_msgs[i][0]]);
            var msgs_elevation = msgs.map(m => m.msg_header.elevation_angle * scale);
            var rounded_elevation = msgs_elevation.map(e => Math.round(e * 10) / 10);
            return rounded_elevation;
        }
    }
    get_nyquist_vel(scans = null) {
        /*
        Retrieve the Nyquist velocities of the requested scans.

        Parameters
        ----------
        scans : list or None
            Scans (0 based) for which the Nyquist velocities will be
            retrieved. None (the default) will return the velocities for all
            scans in the volume.

        Returns
        -------
        velocities : ndarray
            Nyquist velocities (in m/s) for the requested scans.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        return this._radial_sub_array(scans, 'nyquist_vel').map(i => i * 0.01);
    }
    get_unambigous_range(scans = null) {
        /*
        Retrieve the unambiguous range of the requested scans.

        Parameters
        ----------
        scans : list or None
            Scans (0 based) for which the unambiguous range will be retrieved.
            None (the default) will return the range for all scans in the
            volume.

        Returns
        -------
        unambiguous_range : ndarray
            Unambiguous range (in meters) for the requested scans.
        */

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }
        // unambiguous range is stored in tenths of km, x100 for meters
        return this._radial_sub_array(scans, 'unambig_range').map(i => i * 100.0);
    }
    get_data(moment, scans = null, raw_data = false) {
        /*
        Retrieve moment data for a given set of scans.

        Masked points indicate that the data was not collected, below
        threshold or is range folded.

        Parameters
        ----------
        moment : 'REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', or 'CFP'
            Moment for which to to retrieve data.
        raw_data : bool
            True to return the raw data, False to perform masking as well as
            applying the appropiate scale and offset to the data.  When
            raw_data is True values of 1 in the data likely indicate that
            the gate was not present in the sweep, in some cases in will
            indicate range folded data.
        scans : list or None.
            Scans to retrieve data from (0 based). None (the default) will
            get the data for all scans in the volume.

        Returns
        -------
        data : ndarray
        */

        function _masked_less_equal(arr, val) {
            var masked_data = [];
            for (var i = 0; i < arr.length; i++) {
                var row = [];
                for (var j = 0; j < arr[i].length; j++) {
                    if (arr[i][j] <= val) {
                        row.push(null);
                    } else {
                        row.push(arr[i][j]);
                    }
                }
                masked_data.push(row);
            }
            return masked_data;
        }

        if (scans == null) {
            scans = Array.from({ length: this.nscans }, (_, i) => i);
        }

        var max_ngates = this.get_ngates(scans[0], moment);

        // determine the number of rays
        var msg_nums = this._msg_nums(scans);
        var nrays = msg_nums.length;
        // extract the data
        var set_datatype = false;
        var data = Array.from({ length: nrays }, () => Array(max_ngates).fill(1));
        for (var [i, msg_num] of msg_nums.entries()) {
            var msg = this.radial_records[msg_num];
            if (!msg.hasOwnProperty(moment)) {
                continue;
            }
            // if (!set_datatype) {
            //     data = data.astype('>' + _bits_to_code(msg, moment));
            //     set_datatype = true;
            // }
            var ngates = Math.min(msg[moment]['ngates'], max_ngates, msg[moment]['data'].length);
            data[i] = Array.from(msg[moment]['data']);
        }
        // return raw data if requested
        if (raw_data) {
            return data;
        }

        // mask, scan and offset, assume that the offset and scale
        // are the same in all scans/gates
        for (var scan of scans) {  // find a scan which contains the moment
            var msg_num = this.scan_msgs[scan][0];
            var msg = this.radial_records[msg_num];
            if (msg.hasOwnProperty(moment)) {
                var offset = new Float32Array([msg[moment]['offset']])[0];
                var scale = new Float32Array([msg[moment]['scale']])[0];
                var mask = data.map(row => row.map(val => val <= 1));
                var scaled_data = data.map(row => row.map(val => (val - offset) / scale));
                return scaled_data.map((row, i) => row.map((val, j) => {
                    var is_masked = mask[i][j];
                    return is_masked ? null : val;
                }));
            }
        }

        // moment is not present in any scan, mask all values
        return data.map(row => row.map(val => (val <= 1) ? null : val));
    }
}

function _bits_to_code(msg, moment) {
    /*
    Convert number of bits to the proper code for unpacking.
    Based on the code found in MetPy:
    https://github.com/Unidata/MetPy/blob/40d5c12ab341a449c9398508bd41
    d010165f9eeb/src/metpy/io/_tools.py#L313-L321
    */

    if (msg['header']['type'] == 1) {
        return 'B';
        // var word_size = msg[moment]['data'].dtype;
        // if (word_size = 'uint16') {
        //     return 'H';
        // } else if (word_size == 'uint8') {
        //     return 'B';
        // } else {
        //     console.warn('Unsupported bit size, returning 'B'.');
        //     return 'B';
        // }
    } else if (msg['header']['type'] == 31) {
        var word_size = msg[moment]['word_size'];
        if (word_size == 16) {
            return 'H';
        } else if (word_size == 8) {
            return 'B';
        } else {
            console.warn('Unsupported bit size, returning "B".');
            return 'B';
        }
    } else {
        console.error(`Unsupported msg type ${msg['header']['type']}`);
    }
}

function _get_record_from_buf(buf, pos) {
    /* Retrieve and unpack a NEXRAD record from a buffer. */
    var dic = {'header': _unpack_from_buf(buf, pos, level2_constants.MSG_HEADER)};
    var msg_type = dic['header']['type'];
    // if (msg_type != 31) {
    //     console.log(msg_type)
    // }

    var new_pos;
    if (msg_type == 31) {
        new_pos = _get_msg31_from_buf(buf, pos, dic);
    } else if (msg_type == 5) {
        // Sometimes we encounter incomplete buffers
        try {
            new_pos = _get_msg5_from_buf(buf, pos, dic);
        } catch (e) {
            console.warn('Encountered incomplete MSG5. File may be corrupt.');
            new_pos = pos + level2_constants.RECORD_SIZE;
        }
    } else if (msg_type == 29) {
        new_pos = _get_msg29_from_buf(pos, dic);
        // warnings.warn('Message 29 encountered, not parsing.', RuntimeWarning)
    } else if (msg_type == 1) {
        new_pos = _get_msg1_from_buf(buf, pos, dic);
    } else { // not message 31 or 1, no decoding performed
        new_pos = pos + level2_constants.RECORD_SIZE;
    }

    return [new_pos, dic];
}

function _get_msg1_from_buf(buf, pos, dic) {
    /* Retrieve and unpack a MSG1 record from a buffer. */
    var msg_header_size = _structure_size(level2_constants.MSG_HEADER);
    var msg1_header = _unpack_from_buf(buf, pos + msg_header_size, level2_constants.MSG_1);
    dic['msg_header'] = msg1_header;

    var sur_nbins = parseInt(msg1_header['sur_nbins']);
    var doppler_nbins = parseInt(msg1_header['doppler_nbins']);

    var sur_step = parseInt(msg1_header['sur_range_step']);
    var doppler_step = parseInt(msg1_header['doppler_range_step']);

    var sur_first = parseInt(msg1_header['sur_range_first']);
    var doppler_first = parseInt(msg1_header['doppler_range_first']);
    if (doppler_first > 2**15) {
        doppler_first = doppler_first - 2**16;
    }

    function _check_empty(moment, nbins) {
        var key = moment;
        if (nbins == 0) {
            key = `${moment}_empty`;
        }
        return key;
    }

    if (msg1_header['sur_pointer']) {
        var offset = pos + msg_header_size + msg1_header['sur_pointer']
        var data = Uint8Array.from(buf.slice(offset, offset + sur_nbins));

        var key = _check_empty('REF', sur_nbins);
        dic[key] = {
            'ngates': sur_nbins,
            'gate_spacing': sur_step,
            'first_gate': sur_first,
            'data': data,
            'scale': 2.0,
            'offset': 66.0,
        }
    }
    if (msg1_header['vel_pointer']) {
        var offset = pos + msg_header_size + msg1_header['vel_pointer']
        var data = Uint8Array.from(buf.slice(offset, offset + doppler_nbins));

        var key = _check_empty('VEL', doppler_nbins);
        dic[key] = {
            'ngates': doppler_nbins,
            'gate_spacing': doppler_step,
            'first_gate': doppler_first,
            'data': data,
            'scale': 2.0,
            'offset': 129.0,
        }
        if (msg1_header['doppler_resolution'] == 4) {
            // 1 m/s resolution velocity, offset remains 129.
            dic['VEL']['scale'] = 1.0
        }
    }
    if (msg1_header['width_pointer']) {
        var offset = pos + msg_header_size + msg1_header['width_pointer']
        var data = Uint8Array.from(buf.slice(offset, offset + doppler_nbins));

        var key = _check_empty('SW', doppler_nbins);
        dic[key] = {
            'ngates': doppler_nbins,
            'gate_spacing': doppler_step,
            'first_gate': doppler_first,
            'data': data,
            'scale': 2.0,
            'offset': 129.0,
        }
    }
    return pos + level2_constants.RECORD_SIZE;
}

function _get_msg29_from_buf(pos, dic) {
    var msg_size = dic['header']['size'];
    if (msg_size == 65535) {
        msg_size = (dic['header']['segments'] << 16) | dic['header']['seg_num'];
    }
    var msg_header_size = _structure_size(level2_constants.MSG_HEADER)
    var new_pos = pos + msg_header_size + msg_size
    return new_pos;
}

function _get_msg5_from_buf(buf, pos, dic) {
    /* Retrieve and unpack a MSG5 record from a buffer. */
    var msg_header_size = _structure_size(level2_constants.MSG_HEADER);
    var msg5_header_size = _structure_size(level2_constants.MSG_5);
    var msg5_elev_size = _structure_size(level2_constants.MSG_5_ELEV);

    dic['msg5_header'] = _unpack_from_buf(buf, pos + msg_header_size, level2_constants.MSG_5);
    dic['cut_parameters'] = [];
    for (var i = 0; i < dic['msg5_header']['num_cuts']; i++) {
        var pos2 = pos + msg_header_size + msg5_header_size + msg5_elev_size * i;
        dic['cut_parameters'].push(_unpack_from_buf(buf, pos2, level2_constants.MSG_5_ELEV));
    }
    return pos + level2_constants.RECORD_SIZE;
}

function _get_msg31_from_buf(buf, pos, dic) {
    /* Retrieve and unpack a MSG31 record from a buffer. */
    var msg_size = dic['header']['size'] * 2 - 4;
    var msg_header_size = _structure_size(level2_constants.MSG_HEADER);
    var new_pos = pos + msg_header_size + msg_size;
    var mbuf = buf.slice(pos + msg_header_size, new_pos);
    var msg_31_header = _unpack_from_buf(mbuf, 0, level2_constants.MSG_31);

    var block_pointers = Object.values(msg_31_header).filter((v, k) => Object.keys(msg_31_header)[k].startsWith('block_pointer') && v > 0);
    for (var i in block_pointers) {
        var block_pointer = block_pointers[i];
        var [block_name, block_dic] = _get_msg31_data_block(mbuf, block_pointer);
        dic[block_name] = block_dic;
    }

    dic['msg_header'] = msg_31_header;
    return new_pos;
}

function swap16(buffer) {
    const length = buffer.length / 2;
    var data = new Uint16Array(length);
    for (let i = 0; i < length; i++) {
        // Combine two Uint8Array elements into one Uint16Array element
        data[i] = (buffer[i * 2] << 8) | buffer[i * 2 + 1];
    }
    return data;
}

function _get_msg31_data_block(buf, ptr) {
    /* Unpack a msg_31 data block into a dictionary. */
    var block_name = _bufferToString(buf.slice(ptr + 1, ptr + 4)).trim();
    // remove invalid characters (https://stackoverflow.com/a/12756018)
    block_name = block_name.replace(/[^a-z0-9 ,.?!]/ig, '');
    // console.log(block_name)

    var dic;
    if (block_name == 'VOL') {
        dic = _unpack_from_buf(buf, ptr, level2_constants.VOLUME_DATA_BLOCK);
    } else if (block_name == 'ELV') {
        dic = _unpack_from_buf(buf, ptr, level2_constants.ELEVATION_DATA_BLOCK);
    } else if (block_name == 'RAD') {
        dic = _unpack_from_buf(buf, ptr, level2_constants.RADIAL_DATA_BLOCK);
    } else if (['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'].includes(block_name)) {
        dic = _unpack_from_buf(buf, ptr, level2_constants.GENERIC_DATA_BLOCK);
        var ngates = dic['ngates'];
        var ptr2 = ptr + _structure_size(level2_constants.GENERIC_DATA_BLOCK);
        var data;
        if (dic['word_size'] == 16) {
            var buffer = buf.slice(ptr2, ptr2 + ngates * 2);
            data = swap16(buffer);
        } else if (dic['word_size'] == 8) {
            data = Array.from(buf.slice(ptr2, ptr2 + ngates)); // Uint8Array.from()
        } else {
            console.error(`Unsupported bit size: ${s}.`);
        }

        dic['data'] = data;
    } else {
        dic = {};
    }
    return [block_name, dic];
}

class RadarDecompressor {
    constructor() {
        this.unused_data;
    }
    _decompress_chunk(chunk) {
        const algorithm = compressjs.Bzip2;
        return algorithm.decompressFile(chunk);
        // skip 32 bits 'BZh9' header
        // return bzip.decodeBlock(chunk, 32);
        // https://github.com/jvrousseau/bzip2.js
        // return bzip2.simple(bzip2.array(chunk));
    }
    decompress(data) {
        this.compressedData = data;

        var rafData = new RandomAccessFile(data);
        var blockSize = Math.abs(rafData.readInt());
        // console.log(blockSize, data.slice(0, 4))

        data = data.slice(level2_constants.CONTROL_WORD_SIZE, data.length);
        var uncompressed = this._decompress_chunk(data);

        this.unused_data = data.slice(blockSize, data.length);
        if (blockSize > data.length) {
            this.unused_data = new Buffer.alloc(0);
        }

        return uncompressed;
    }
}

function _decompress_records(file_handler) {
    /* Decompressed the records from an BZ2 compressed Archive 2 file. */
    file_handler.seek(0);
    // read all data from the file
    var cbuf = file_handler.peek();
    var decompressor = new RadarDecompressor();
    // skip the radar file header (24 bits)
    var skip = _structure_size(level2_constants.VOLUME_HEADER);
    // initialize the buffer with all of the radar file's data, except for the header
    var buf = [decompressor.decompress(cbuf.slice(skip, cbuf.length))];
    // while there's still data to decompress
    while (decompressor.unused_data.length) {
        // store the remaining compressed data
        cbuf = decompressor.unused_data;
        // create a new RadarDecompressor
        decompressor = new RadarDecompressor();
        var decompressed = decompressor.decompress(cbuf);
        // uncompress and push to the final buffer
        buf.push(decompressed);
    }
    // combine the array of Uint8Arrays + 1 buffer to a single buffer
    var finalBuffer = Buffer.concat(buf);
    // trim the 'COMPRESSION_RECORD_SIZE' from the start of the buffer
    finalBuffer = finalBuffer.slice(level2_constants.COMPRESSION_RECORD_SIZE, finalBuffer.length);
    return finalBuffer;
}

function _structure_size(structure) {
    /* Find the size of a structure in bytes. */
    var format = '>' + structure.map(i => i[1]).join('');
    var size = BufferPack.calcLength(format);
    return size;
}

function _unpack_from_buf(buf, pos, structure) {
    /* Unpack a structure from a buffer. */
    var size = _structure_size(structure);
    return _unpack_structure(buf.slice(pos, pos + size), structure);
}

function _unpack_structure(string, structure) {
    /* Unpack a structure from a string. */
    var fmt = '>' + structure.map(i => i[1]).join('');  // NEXRAD is big-endian
    var lst = BufferPack.unpack(fmt, string);
    var result = structure.reduce((acc, curr, index) => {
        acc[curr[0]] = lst[index];
        return acc;
    }, {});
    return result;
}

module.exports = NEXRADLevel2File;
}).call(this)}).call(this,require("buffer").Buffer)
},{"../../../../lib/compressjs/main":21,"../../../core/misc/progress_bar":1,"../buffer_tools/RandomAccessFile":4,"../nexrad_locations":11,"./decompress_worker":6,"./level2_constants":7,"buffer":24,"bufferpack":25,"pako":28,"seek-bzip":47,"webworkify":50}],10:[function(require,module,exports){
const dest_vincenty = require('../../../plot/dest_vincenty')

module.exports = function (self) {
    self.addEventListener('message', function (ev) {
        function _correct_x_y(x, y, lngLat) {
            function radians(deg) {
                return (3.141592654 / 180.) * deg;
            }
            function calculateAzimuth(lngLat1, x, y) {
                // Convert x and y to latitude and longitude
                var lon = (x * 360.0) - 180.0;
                var lat = (2.0 * Math.atan(Math.exp((180.0 - y * 360.0) * Math.PI / 180.0)) - Math.PI / 2.0) * 180.0 / Math.PI;

                // Convert latitude and longitude to radians
                var lat1Rad = radians(lngLat1.lat);
                var lon1Rad = radians(lngLat1.lng);
                var lat2Rad = radians(lat);
                var lon2Rad = radians(lon);

                // Calculate the azimuth (bearing)
                var dLon = lon2Rad - lon1Rad;
                var yRad = Math.sin(dLon) * Math.cos(lat2Rad);
                var xRad = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
                var azimuthRad = Math.atan2(yRad, xRad);

                // Convert azimuth from radians to degrees
                var azimuthDegrees = (azimuthRad * 180.0 / Math.PI + 360.0) % 360.0;

                return azimuthDegrees;
            }

            function haversineDistance(lngLat1, x, y) {
                // Convert x and y to latitude and longitude
                var lon = (x * 360.0) - 180.0;
                var lat = (2.0 * Math.atan(Math.exp((180.0 - y * 360.0) * Math.PI / 180.0)) - Math.PI / 2.0) * 180.0 / Math.PI;

                // Radius of the Earth in meters
                var earthRadius = 6371000.0;

                // Convert latitude and longitude to radians
                var lat1Rad = radians(lngLat1.lat);
                var lon1Rad = radians(lngLat1.lng);
                var lat2Rad = radians(lat);
                var lon2Rad = radians(lon);

                // Haversine formula
                var dLat = lat2Rad - lat1Rad;
                var dLon = lon2Rad - lon1Rad;
                var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                var distance = earthRadius * c;

                return distance;
            }

            function mc(coords) {
                function mercatorXfromLng(lng) {
                    return (180 + lng) / 360;
                }
                function mercatorYfromLat(lat) {
                    return (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360;
                }
                return [mercatorXfromLng(coords[0]), mercatorYfromLat(coords[1])];
            }

            const azimuth = calculateAzimuth(lngLat, x, y);
            const range = haversineDistance(lngLat, x, y);
            var calc = mc(dest_vincenty({lng: lngLat.lng, lat: lngLat.lat}, range, azimuth));

            return [calc[0], calc[1]];
        }

        var points = ev.data[0];
        var location = ev.data[1];
        const lngLat = {lat: location[0], lng: location[1]};

        for (var i = 0; i < points.length; i += 2) {
            var az = points[i + 1];
            var distance = points[i];
            var calc = _correct_x_y(distance, az, lngLat);
            points[i] = calc[0];
            points[i + 1] = calc[1];
        }

        self.postMessage(points);
    })
}
},{"../../../plot/dest_vincenty":12}],11:[function(require,module,exports){
function get_nexrad_location(station) {
    var loc = NEXRAD_LOCATIONS?.[station.toUpperCase()];
    if (loc == undefined) {
        return [0, 0, 0];
    }
    return [loc['lat'], loc['lon'], loc['elev']];
}

/**
 * Taken from https://api.weather.gov/radar/stations.
 * Elevation units are in meters.
 */
const NEXRAD_LOCATIONS = {
    'KBGM': {
        'lat': 42.1996899,
        'lon': -75.98472,
        'elev': 489.51,
        'type': 'WSR-88D',
        'name': 'Binghamton'
    },
    'KMVX': {
        'lat': 47.52805,
        'lon': -97.32499,
        'elev': 300.53,
        'type': 'WSR-88D',
        'name': 'Fargo'
    },
    'KHPX': {
        'lat': 36.73666,
        'lon': -87.2849899,
        'elev': 172,
        'type': 'WSR-88D',
        'name': 'Ft. Campbell'
    },
    'KRGX': {
        'lat': 39.75405,
        'lon': -119.46202,
        'elev': 2529.54,
        'type': 'WSR-88D',
        'name': 'Reno'
    },
    'KFSD': {
        'lat': 43.58777,
        'lon': -96.72888,
        'elev': 435.86,
        'type': 'WSR-88D',
        'name': 'Sioux Falls'
    },
    'TEWR': {
        'lat': 40.593,
        'lon': -74.27,
        'elev': 41.45278,
        'type': 'TDWR',
        'name': 'Newark'
    },
    'KCAE': {
        'lat': 33.9486,
        'lon': -81.11861,
        'elev': 70.41,
        'type': 'WSR-88D',
        'name': 'Columbia'
    },
    'TLVE': {
        'lat': 41.29,
        'lon': -82.008,
        'elev': 283.76878,
        'type': 'TDWR',
        'name': 'Cleveland'
    },
    'TMSP': {
        'lat': 44.871,
        'lon': -92.933,
        'elev': 341.68078,
        'type': 'TDWR',
        'name': 'Minneapolis'
    },
    'KMKX': {
        'lat': 42.96777,
        'lon': -88.55055,
        'elev': 292,
        'type': 'WSR-88D',
        'name': 'Milwaukee'
    },
    'KDIX': {
        'lat': 39.94694,
        'lon': -74.41072,
        'elev': 45.42,
        'type': 'WSR-88D',
        'name': 'Mt. Holly'
    },
    'PAKC': {
        'lat': 58.67944,
        'lon': -156.62942,
        'elev': 19.2,
        'type': 'WSR-88D',
        'name': 'King Salmon'
    },
    'PABC': {
        'lat': 60.79194,
        'lon': -161.87637,
        'elev': 49.07,
        'type': 'WSR-88D',
        'name': 'Bethel'
    },
    'KBOX': {
        'lat': 41.95577,
        'lon': -71.13686,
        'elev': 35.97,
        'type': 'WSR-88D',
        'name': 'Boston'
    },
    'KGRR': {
        'lat': 42.89388,
        'lon': -85.54488,
        'elev': 237.13,
        'type': 'WSR-88D',
        'name': 'Grand Rapids'
    },
    'KFTG': {
        'lat': 39.78663,
        'lon': -104.5458,
        'elev': 1675.49,
        'type': 'WSR-88D',
        'name': 'Denver'
    },
    'KLCH': {
        'lat': 30.1253,
        'lon': -93.21588,
        'elev': 17,
        'type': 'WSR-88D',
        'name': 'Lake Charles'
    },
    'KYUX': {
        'lat': 32.49527,
        'lon': -114.65668,
        'elev': 53.04,
        'type': 'WSR-88D',
        'name': 'Yuma'
    },
    'KSHV': {
        'lat': 32.45083,
        'lon': -93.84124,
        'elev': 83.21,
        'type': 'WSR-88D',
        'name': 'Shreveport'
    },
    'KSRX': {
        'lat': 35.29041,
        'lon': -94.36188,
        'elev': 200,
        'type': 'WSR-88D',
        'name': 'Ft. Smith'
    },
    'TJFK': {
        'lat': 40.589,
        'lon': -73.881,
        'elev': 34.13758,
        'type': 'TDWR',
        'name': 'New York City'
    },
    'TMCO': {
        'lat': 28.344,
        'lon': -81.3259999,
        'elev': 51.51118,
        'type': 'TDWR',
        'name': 'Orlando International'
    },
    'KICX': {
        'lat': 37.59104,
        'lon': -112.86221,
        'elev': 3244,
        'type': 'WSR-88D',
        'name': 'Cedar City'
    },
    'KMOB': {
        'lat': 30.67944,
        'lon': -88.23972,
        'elev': 63.4,
        'type': 'WSR-88D',
        'name': 'Mobile'
    },
    'KMRX': {
        'lat': 36.16833,
        'lon': -83.40194,
        'elev': 407.52,
        'type': 'WSR-88D',
        'name': 'Knoxville'
    },
    'KVBX': {
        'lat': 34.83855,
        'lon': -120.3979,
        'elev': 383,
        'type': 'WSR-88D',
        'name': 'Vandenberg AFB'
    },
    'KJGX': {
        'lat': 32.67499,
        'lon': -83.35111,
        'elev': 158.8,
        'type': 'WSR-88D',
        'name': 'Robins AFB'
    },
    'KIWA': {
        'lat': 33.28916,
        'lon': -111.66999,
        'elev': 415,
        'type': 'WSR-88D',
        'name': 'Phoenix'
    },
    'KLOT': {
        'lat': 41.6044399,
        'lon': -88.08444,
        'elev': 202.08,
        'type': 'WSR-88D',
        'name': 'Chicago'
    },
    'KPOE': {
        'lat': 31.15527,
        'lon': -92.97583,
        'elev': 124.36,
        'type': 'WSR-88D',
        'name': 'Ft. Polk'
    },
    'KEAX': {
        'lat': 38.81024,
        'lon': -94.26446,
        'elev': 303.28,
        'type': 'WSR-88D',
        'name': 'Kansas City'
    },
    'PAHG': {
        'lat': 60.72591,
        'lon': -151.35144,
        'elev': 73.76,
        'type': 'WSR-88D',
        'name': 'Kenai'
    },
    'TTUL': {
        'lat': 36.071,
        'lon': -95.827,
        'elev': 250.85038,
        'type': 'TDWR',
        'name': 'Tulsa'
    },
    'TJUA': {
        'lat': 18.1156599,
        'lon': -66.07817,
        'elev': 867,
        'type': 'WSR-88D',
        'name': 'San Juan'
    },
    'KDVN': {
        'lat': 41.61166,
        'lon': -90.58083,
        'elev': 229.82,
        'type': 'WSR-88D',
        'name': 'Quad Cities'
    },
    'KLVX': {
        'lat': 37.97527,
        'lon': -85.9438799,
        'elev': 219.15,
        'type': 'WSR-88D',
        'name': 'Louisville'
    },
    'KHNX': {
        'lat': 36.31416,
        'lon': -119.63213,
        'elev': 74.07,
        'type': 'WSR-88D',
        'name': 'San Joaquin Valley'
    },
    'KLWX': {
        'lat': 38.9761,
        'lon': -77.4875,
        'elev': 88.54,
        'type': 'WSR-88D',
        'name': 'Sterling'
    },
    'KGWX': {
        'lat': 33.89691,
        'lon': -88.32919,
        'elev': 155,
        'type': 'WSR-88D',
        'name': 'Columbus AFB'
    },
    'KDDC': {
        'lat': 37.76083,
        'lon': -99.96888,
        'elev': 789.43,
        'type': 'WSR-88D',
        'name': 'Dodge City'
    },
    'KDMX': {
        'lat': 41.7311,
        'lon': -93.7228499,
        'elev': 299.01,
        'type': 'WSR-88D',
        'name': 'Des Moines'
    },
    'PHKM': {
        'lat': 20.12527,
        'lon': -155.77776,
        'elev': 1174,
        'type': 'WSR-88D',
        'name': 'Kohala'
    },
    'KDLH': {
        'lat': 46.83694,
        'lon': -92.20971,
        'elev': 435.25,
        'type': 'WSR-88D',
        'name': 'Duluth'
    },
    'KEVX': {
        'lat': 30.56503,
        'lon': -85.92166,
        'elev': 42.67,
        'type': 'WSR-88D',
        'name': 'Eglin AFB'
    },
    'TORD': {
        'lat': 41.797,
        'lon': -87.858,
        'elev': 226.77118,
        'type': 'TDWR',
        'name': "Chicago O'Hare"
    },
    'KMAF': {
        'lat': 31.94346,
        'lon': -102.18924,
        'elev': 883,
        'type': 'WSR-88D',
        'name': 'Odessa'
    },
    'KVNX': {
        'lat': 36.74083,
        'lon': -98.12749,
        'elev': 368.81,
        'type': 'WSR-88D',
        'name': 'Vance AFB'
    },
    'KOTX': {
        'lat': 47.6805499,
        'lon': -117.62582,
        'elev': 726.64,
        'type': 'WSR-88D',
        'name': 'Spokane'
    },
    'KBBX': {
        'lat': 39.49611,
        'lon': -121.63165,
        'elev': 52.73,
        'type': 'WSR-88D',
        'name': 'Beale AFB'
    },
    'TADW': {
        'lat': 38.695,
        'lon': -76.845,
        'elev': 105.46078,
        'type': 'TDWR',
        'name': 'Andrews Air Force Base'
    },
    'TCLT': {
        'lat': 35.337,
        'lon': -80.885,
        'elev': 265.48078,
        'type': 'TDWR',
        'name': 'Charlotte'
    },
    'KGRK': {
        'lat': 30.72166,
        'lon': -97.3827699,
        'elev': 163.98,
        'type': 'WSR-88D',
        'name': 'Ft. Hood'
    },
    'TSTL': {
        'lat': 38.805,
        'lon': -90.489,
        'elev': 197.20558,
        'type': 'TDWR',
        'name': 'St. Louis'
    },
    'KEWX': {
        'lat': 29.70405,
        'lon': -98.0286,
        'elev': 204,
        'type': 'WSR-88D',
        'name': 'Austin-San Antonio'
    },
    'KRAX': {
        'lat': 35.66527,
        'lon': -78.49,
        'elev': 106.07,
        'type': 'WSR-88D',
        'name': 'Raleigh-Durham'
    },
    'KLNX': {
        'lat': 41.95794,
        'lon': -100.57621,
        'elev': 919,
        'type': 'WSR-88D',
        'name': 'North Platte'
    },
    'KLBB': {
        'lat': 33.65413,
        'lon': -101.81416,
        'elev': 1005,
        'type': 'WSR-88D',
        'name': 'Lubbock'
    },
    'TSJU': {
        'lat': 18.474,
        'lon': -66.179,
        'elev': 47.85358,
        'type': 'TDWR',
        'name': 'San Juan'
    },
    'HWPA2': {
        'lat': 59.65,
        'lon': -151.46,
        'elev': 7.6,
        'type': 'Profiler',
        'name': 'Homer'
    },
    'KPDT': {
        'lat': 45.69055,
        'lon': -118.8529,
        'elev': 461.77,
        'type': 'WSR-88D',
        'name': 'Pendleton'
    },
    'KGSP': {
        'lat': 34.8833,
        'lon': -82.21983,
        'elev': 291,
        'type': 'WSR-88D',
        'name': 'Greenville-Spartanburg'
    },
    'KEOX': {
        'lat': 31.46055,
        'lon': -85.45938,
        'elev': 144,
        'type': 'WSR-88D',
        'name': 'Ft. Rucker'
    },
    'KBIS': {
        'lat': 46.7708299,
        'lon': -100.76027,
        'elev': 505.36,
        'type': 'WSR-88D',
        'name': 'Bismarck'
    },
    'TDFW': {
        'lat': 33.065,
        'lon': -96.918,
        'elev': 178.30798,
        'type': 'TDWR',
        'name': 'Dallas/Ft. Worth'
    },
    'PAIH': {
        'lat': 59.46194,
        'lon': -146.3010899,
        'elev': 20.42,
        'type': 'WSR-88D',
        'name': 'Middleton Islands'
    },
    'KBYX': {
        'lat': 24.59694,
        'lon': -81.7033299,
        'elev': 2.44,
        'type': 'WSR-88D',
        'name': 'Key West'
    },
    'KJAX': {
        'lat': 30.48463,
        'lon': -81.7019,
        'elev': 19,
        'type': 'WSR-88D',
        'name': 'Jacksonville'
    },
    'KFDX': {
        'lat': 34.63416,
        'lon': -103.61888,
        'elev': 1417.32,
        'type': 'WSR-88D',
        'name': 'Cannon AFB'
    },
    'TSLC': {
        'lat': 40.967,
        'lon': -111.93,
        'elev': 1309.11598,
        'type': 'TDWR',
        'name': 'Salt Lake City'
    },
    'TPHX': {
        'lat': 33.421,
        'lon': -112.163,
        'elev': 331.92718,
        'type': 'TDWR',
        'name': 'Phoenix'
    },
    'KESX': {
        'lat': 35.70111,
        'lon': -114.89138,
        'elev': 1483.46,
        'type': 'WSR-88D',
        'name': 'Las Vegas'
    },
    'TCMH': {
        'lat': 40.006,
        'lon': -82.715,
        'elev': 349.91038,
        'type': 'TDWR',
        'name': 'Columbus'
    },
    'KDYX': {
        'lat': 32.53833,
        'lon': -99.25416,
        'elev': 462.38,
        'type': 'WSR-88D',
        'name': 'Dyess AFB'
    },
    'KTBW': {
        'lat': 27.70527,
        'lon': -82.40194,
        'elev': 12.5,
        'type': 'WSR-88D',
        'name': 'Tampa Bay'
    },
    'TMSY': {
        'lat': 30.022,
        'lon': -90.403,
        'elev': 30.17518,
        'type': 'TDWR',
        'name': 'New Orleans'
    },
    'KDFX': {
        'lat': 29.2725,
        'lon': -100.28027,
        'elev': 344.73,
        'type': 'WSR-88D',
        'name': 'Laughlin AFB'
    },
    'TBNA': {
        'lat': 35.9799999,
        'lon': -86.662,
        'elev': 249.02158,
        'type': 'TDWR',
        'name': 'Nashville'
    },
    'TMIA': {
        'lat': 25.758,
        'lon': -80.491,
        'elev': 38.09998,
        'type': 'TDWR',
        'name': 'Miami'
    },
    'TATL': {
        'lat': 33.647,
        'lon': -84.262,
        'elev': 327.65998,
        'type': 'TDWR',
        'name': 'Atlanta'
    },
    'KMUX': {
        'lat': 37.15522,
        'lon': -121.89843,
        'elev': 1057.35,
        'type': 'WSR-88D',
        'name': 'San Francisco'
    },
    'KBRO': {
        'lat': 25.91555,
        'lon': -97.4186,
        'elev': 7.01,
        'type': 'WSR-88D',
        'name': 'Brownsville'
    },
    'RKJK': {
        'lat': 35.9241699,
        'lon': 126.62222,
        'elev': 23.77,
        'type': 'WSR-88D',
        'name': 'Kunsan AB'
    },
    'KAKQ': {
        'lat': 36.98388,
        'lon': -77.0074999,
        'elev': 48,
        'type': 'WSR-88D',
        'name': 'Norfolk-Richmond'
    },
    'KBMX': {
        'lat': 33.17194,
        'lon': -86.76972,
        'elev': 196.6,
        'type': 'WSR-88D',
        'name': 'Birmingham'
    },
    'TPIT': {
        'lat': 40.501,
        'lon': -80.486,
        'elev': 422.45278,
        'type': 'TDWR',
        'name': 'Pittsburgh'
    },
    'TMDW': {
        'lat': 41.651,
        'lon': -87.73,
        'elev': 232.56238,
        'type': 'TDWR',
        'name': 'Chicago Midway'
    },
    'KABR': {
        'lat': 45.45583,
        'lon': -98.41305,
        'elev': 396.85,
        'type': 'WSR-88D',
        'name': 'Aberdeen'
    },
    'KSFX': {
        'lat': 43.10559,
        'lon': -112.68612,
        'elev': 1363.68,
        'type': 'WSR-88D',
        'name': 'Idaho Falls'
    },
    'KSOX': {
        'lat': 33.81773,
        'lon': -117.63599,
        'elev': 927,
        'type': 'WSR-88D',
        'name': 'Santa Ana Mountains'
    },
    'KTLH': {
        'lat': 30.39749,
        'lon': -84.32889,
        'elev': 19.2,
        'type': 'WSR-88D',
        'name': 'Tallahassee'
    },
    'KHGX': {
        'lat': 29.47194,
        'lon': -95.07888,
        'elev': 5.49,
        'type': 'WSR-88D',
        'name': 'Houston'
    },
    'KAMX': {
        'lat': 25.61055,
        'lon': -80.41305,
        'elev': 4.27,
        'type': 'WSR-88D',
        'name': 'Miami'
    },
    'KMTX': {
        'lat': 41.26277,
        'lon': -112.44777,
        'elev': 1975,
        'type': 'WSR-88D',
        'name': 'Salt Lake City'
    },
    'TDAY': {
        'lat': 40.022,
        'lon': -84.123,
        'elev': 310.59118,
        'type': 'TDWR',
        'name': 'Dayton'
    },
    'KEPZ': {
        'lat': 31.87305,
        'lon': -106.69799,
        'elev': 1250.9,
        'type': 'WSR-88D',
        'name': 'El Paso'
    },
    'KLZK': {
        'lat': 34.83638,
        'lon': -92.26194,
        'elev': 173.13,
        'type': 'WSR-88D',
        'name': 'Little Rock'
    },
    'KHTX': {
        'lat': 34.9305499,
        'lon': -86.0836099,
        'elev': 537.06,
        'type': 'WSR-88D',
        'name': 'Huntsville-Hytop'
    },
    'KEYX': {
        'lat': 35.09777,
        'lon': -117.56074,
        'elev': 846,
        'type': 'WSR-88D',
        'name': 'Edwards AFB'
    },
    'KSGF': {
        'lat': 37.23527,
        'lon': -93.40027,
        'elev': 389.53,
        'type': 'WSR-88D',
        'name': 'Springfield'
    },
    'KBLX': {
        'lat': 45.85377,
        'lon': -108.60679,
        'elev': 1109,
        'type': 'WSR-88D',
        'name': 'Billings'
    },
    'KPUX': {
        'lat': 38.45944,
        'lon': -104.18138,
        'elev': 1615,
        'type': 'WSR-88D',
        'name': 'Pueblo'
    },
    'KHDX': {
        'lat': 33.07699,
        'lon': -106.12002,
        'elev': 1286.87,
        'type': 'WSR-88D',
        'name': 'Holloman AFB'
    },
    'KINX': {
        'lat': 36.17499,
        'lon': -95.56413,
        'elev': 203.61,
        'type': 'WSR-88D',
        'name': 'Tulsa'
    },
    'KIWX': {
        'lat': 41.3586,
        'lon': -85.7,
        'elev': 292.3,
        'type': 'WSR-88D',
        'name': 'North Webster'
    },
    'KGGW': {
        'lat': 48.20635,
        'lon': -106.62468,
        'elev': 702,
        'type': 'WSR-88D',
        'name': 'Glasgow'
    },
    'KNQA': {
        'lat': 35.34472,
        'lon': -89.87333,
        'elev': 103,
        'type': 'WSR-88D',
        'name': 'Memphis'
    },
    'TDAL': {
        'lat': 32.926,
        'lon': -96.968,
        'elev': 189.58558,
        'type': 'TDWR',
        'name': 'Dallas Love Field'
    },
    'RODN': {
        'lat': 26.3019399,
        'lon': 127.90972,
        'elev': 91,
        'type': 'WSR-88D',
        'name': 'Kadena'
    },
    'TPBI': {
        'lat': 26.688,
        'lon': -80.273,
        'elev': 40.53838,
        'type': 'TDWR',
        'name': 'West Palm Beach'
    },
    'KCLX': {
        'lat': 32.65552,
        'lon': -81.04219,
        'elev': 35,
        'type': 'WSR-88D',
        'name': 'Charleston'
    },
    'KIND': {
        'lat': 39.70749,
        'lon': -86.28027,
        'elev': 240.79,
        'type': 'WSR-88D',
        'name': 'Indianapolis'
    },
    'TTPA': {
        'lat': 27.86,
        'lon': -82.518,
        'elev': 28.34638,
        'type': 'TDWR',
        'name': 'Tampa Bay'
    },
    'KOKX': {
        'lat': 40.8655199,
        'lon': -72.8639199,
        'elev': 25.91,
        'type': 'WSR-88D',
        'name': 'New York City'
    },
    'KGLD': {
        'lat': 39.36694,
        'lon': -101.70027,
        'elev': 1112.82,
        'type': 'WSR-88D',
        'name': 'Goodland'
    },
    'KVTX': {
        'lat': 34.41166,
        'lon': -119.1786,
        'elev': 830.88,
        'type': 'WSR-88D',
        'name': 'Los Angeles'
    },
    'KICT': {
        'lat': 37.65444,
        'lon': -97.44305,
        'elev': 406.91,
        'type': 'WSR-88D',
        'name': 'Wichita'
    },
    'TDEN': {
        'lat': 39.728,
        'lon': -104.526,
        'elev': 1737.66478,
        'type': 'TDWR',
        'name': 'Denver'
    },
    'TPHL': {
        'lat': 39.949,
        'lon': -75.069,
        'elev': 46.63438,
        'type': 'TDWR',
        'name': 'Philadelphia'
    },
    'ROCO2': {
        'lat': 35.2299999,
        'lon': -97.45,
        'elev': 363.3,
        'type': 'Profiler',
        'name': 'Norman'
    },
    'TCVG': {
        'lat': 38.898,
        'lon': -84.58,
        'elev': 320.95438,
        'type': 'TDWR',
        'name': 'Covington'
    },
    'KDOX': {
        'lat': 38.82555,
        'lon': -75.44,
        'elev': 15.24,
        'type': 'WSR-88D',
        'name': 'Dover AFB'
    },
    'TBWI': {
        'lat': 39.09,
        'lon': -76.63,
        'elev': 90.52558,
        'type': 'TDWR',
        'name': 'Baltimore/Wash'
    },
    'KRIW': {
        'lat': 43.0661,
        'lon': -108.47729,
        'elev': 1697.13,
        'type': 'WSR-88D',
        'name': 'Riverton'
    },
    'KVAX': {
        'lat': 30.89027,
        'lon': -83.0018,
        'elev': 66,
        'type': 'WSR-88D',
        'name': 'Moody AFB'
    },
    'KABX': {
        'lat': 35.14972,
        'lon': -106.82388,
        'elev': 1789.18,
        'type': 'WSR-88D',
        'name': 'Albuquerque'
    },
    'KNKX': {
        'lat': 32.91888,
        'lon': -117.04193,
        'elev': 291.08,
        'type': 'WSR-88D',
        'name': 'San Diego'
    },
    'PACG': {
        'lat': 56.85277,
        'lon': -135.5291499,
        'elev': 63.09,
        'type': 'WSR-88D',
        'name': 'Biorka Island'
    },
    'KMSX': {
        'lat': 47.0411,
        'lon': -113.9861,
        'elev': 2417,
        'type': 'WSR-88D',
        'name': 'Missoula'
    },
    'KGRB': {
        'lat': 44.49862,
        'lon': -88.1110999,
        'elev': 216,
        'type': 'WSR-88D',
        'name': 'Green Bay'
    },
    'KATX': {
        'lat': 48.19461,
        'lon': -122.49568,
        'elev': 161,
        'type': 'WSR-88D',
        'name': 'Seattle-Tacoma'
    },
    'TSDF': {
        'lat': 38.046,
        'lon': -85.61,
        'elev': 222.80878,
        'type': 'TDWR',
        'name': 'Louisville'
    },
    'KCRP': {
        'lat': 27.78388,
        'lon': -97.51083,
        'elev': 13.72,
        'type': 'WSR-88D',
        'name': 'Corpus Christi'
    },
    'TLAS': {
        'lat': 36.144,
        'lon': -115.007,
        'elev': 627.27838,
        'type': 'TDWR',
        'name': 'Las Vegas'
    },
    'TFLL': {
        'lat': 26.143,
        'lon': -80.344,
        'elev': 36.57598,
        'type': 'TDWR',
        'name': 'Fort Lauderdale'
    },
    'TIAD': {
        'lat': 39.084,
        'lon': -77.529,
        'elev': 144.17038,
        'type': 'TDWR',
        'name': 'Dulles'
    },
    'KSJT': {
        'lat': 31.37111,
        'lon': -100.49221,
        'elev': 576.07,
        'type': 'WSR-88D',
        'name': 'San Angelo'
    },
    'TDTW': {
        'lat': 42.111,
        'lon': -83.515,
        'elev': 235.30558,
        'type': 'TDWR',
        'name': 'Detroit'
    },
    'KPBZ': {
        'lat': 40.53166,
        'lon': -80.21794,
        'elev': 361.19,
        'type': 'WSR-88D',
        'name': 'Pittsburgh'
    },
    'TMEM': {
        'lat': 34.896,
        'lon': -89.993,
        'elev': 147.21838,
        'type': 'TDWR',
        'name': 'Memphis'
    },
    'KPAH': {
        'lat': 37.06833,
        'lon': -88.77194,
        'elev': 119.48,
        'type': 'WSR-88D',
        'name': 'Paducah'
    },
    'KLIX': {
        'lat': 30.33666,
        'lon': -89.82541,
        'elev': 20,
        'type': 'WSR-88D',
        'name': 'New Orleans'
    },
    'KRTX': {
        'lat': 45.71499,
        'lon': -122.96499,
        'elev': 492,
        'type': 'WSR-88D',
        'name': 'Portland'
    },
    'TMCI': {
        'lat': 39.498,
        'lon': -94.742,
        'elev': 332.23198,
        'type': 'TDWR',
        'name': 'Kansas City'
    },
    'KFCX': {
        'lat': 37.02416,
        'lon': -80.27416,
        'elev': 874.17,
        'type': 'WSR-88D',
        'name': 'Roanoke'
    },
    'KARX': {
        'lat': 43.82277,
        'lon': -91.1911,
        'elev': 388.92,
        'type': 'WSR-88D',
        'name': 'LaCrosse'
    },
    'KJKL': {
        'lat': 37.5908299,
        'lon': -83.31305,
        'elev': 415.75,
        'type': 'WSR-88D',
        'name': 'Jackson'
    },
    'KGYX': {
        'lat': 43.8913,
        'lon': -70.25636,
        'elev': 124.66,
        'type': 'WSR-88D',
        'name': 'Portland'
    },
    'KAMA': {
        'lat': 35.23333,
        'lon': -101.70927,
        'elev': 1104,
        'type': 'WSR-88D',
        'name': 'Amarillo'
    },
    'KFSX': {
        'lat': 34.57433,
        'lon': -111.19843,
        'elev': 2260.7,
        'type': 'WSR-88D',
        'name': 'Flagstaff'
    },
    'KMPX': {
        'lat': 44.84888,
        'lon': -93.56552,
        'elev': 301,
        'type': 'WSR-88D',
        'name': 'Minneapolis-St. Paul'
    },
    'TIAH': {
        'lat': 30.065,
        'lon': -95.5669999,
        'elev': 77.11438,
        'type': 'TDWR',
        'name': 'Houston Intercontinental'
    },
    'TICH': {
        'lat': 37.507,
        'lon': -97.437,
        'elev': 411.78478,
        'type': 'TDWR',
        'name': 'Wichita'
    },
    'KCXX': {
        'lat': 44.5111,
        'lon': -73.16639,
        'elev': 96.62,
        'type': 'WSR-88D',
        'name': 'Burlington'
    },
    'KDGX': {
        'lat': 32.27999,
        'lon': -89.98444,
        'elev': 150.92,
        'type': 'WSR-88D',
        'name': 'Jackson'
    },
    'KLSX': {
        'lat': 38.69888,
        'lon': -90.68277,
        'elev': 185.32,
        'type': 'WSR-88D',
        'name': 'St. Louis'
    },
    'KGJX': {
        'lat': 39.06222,
        'lon': -108.21375,
        'elev': 3059,
        'type': 'WSR-88D',
        'name': 'Grand Junction'
    },
    'KOAX': {
        'lat': 41.32027,
        'lon': -96.3668,
        'elev': 349.91,
        'type': 'WSR-88D',
        'name': 'Omaha'
    },
    'PHMO': {
        'lat': 21.13277,
        'lon': -157.18026,
        'elev': 415.44,
        'type': 'WSR-88D',
        'name': 'Molokai'
    },
    'KMXX': {
        'lat': 32.53664,
        'lon': -85.78975,
        'elev': 136,
        'type': 'WSR-88D',
        'name': 'Montgomery-Maxwell AFB'
    },
    'KCBX': {
        'lat': 43.49021,
        'lon': -116.23602,
        'elev': 942,
        'type': 'WSR-88D',
        'name': 'Boise'
    },
    'KRLX': {
        'lat': 38.3111,
        'lon': -81.72277,
        'elev': 335,
        'type': 'WSR-88D',
        'name': 'Charleston'
    },
    'TIDS': {
        'lat': 39.637,
        'lon': -86.436,
        'elev': 258.16558,
        'type': 'TDWR',
        'name': 'Indianapolis'
    },
    'KLTX': {
        'lat': 33.98916,
        'lon': -78.42916,
        'elev': 19.51,
        'type': 'WSR-88D',
        'name': 'Wilmington'
    },
    'KILX': {
        'lat': 40.15049,
        'lon': -89.3367899,
        'elev': 188,
        'type': 'WSR-88D',
        'name': 'Lincoln'
    },
    'KDTX': {
        'lat': 42.69999,
        'lon': -83.47166,
        'elev': 336,
        'type': 'WSR-88D',
        'name': 'Detroit'
    },
    'KLRX': {
        'lat': 40.73972,
        'lon': -116.80277,
        'elev': 2067,
        'type': 'WSR-88D',
        'name': 'Elko'
    },
    'TDCA': {
        'lat': 38.759,
        'lon': -76.962,
        'elev': 105.15598,
        'type': 'TDWR',
        'name': 'Washington National'
    },
    'KENX': {
        'lat': 42.58655,
        'lon': -74.06408,
        'elev': 565,
        'type': 'WSR-88D',
        'name': 'Albany'
    },
    'RKSG': {
        'lat': 37.2075699,
        'lon': 127.28556,
        'elev': 439,
        'type': 'WSR-88D',
        'name': 'Camp Humphreys'
    },
    'TMKE': {
        'lat': 42.819,
        'lon': -88.046,
        'elev': 284.37838,
        'type': 'TDWR',
        'name': 'Milwaukee'
    },
    'KOHX': {
        'lat': 36.24722,
        'lon': -86.5625,
        'elev': 176.48,
        'type': 'WSR-88D',
        'name': 'Nashville'
    },
    'KMAX': {
        'lat': 42.08111,
        'lon': -122.71735,
        'elev': 2289.96,
        'type': 'WSR-88D',
        'name': 'Medford'
    },
    'KFDR': {
        'lat': 34.36219,
        'lon': -98.97666,
        'elev': 386.18,
        'type': 'WSR-88D',
        'name': 'Frederick'
    },
    'KMQT': {
        'lat': 46.5311,
        'lon': -87.54833,
        'elev': 430.07,
        'type': 'WSR-88D',
        'name': 'Marquette'
    },
    'KCBW': {
        'lat': 46.03916,
        'lon': -67.80642,
        'elev': 227.38,
        'type': 'WSR-88D',
        'name': 'Hodgdon'
    },
    'KBUF': {
        'lat': 42.9486,
        'lon': -78.73694,
        'elev': 211.23,
        'type': 'WSR-88D',
        'name': 'Buffalo'
    },
    'KTFX': {
        'lat': 47.45972,
        'lon': -111.38527,
        'elev': 1140,
        'type': 'WSR-88D',
        'name': 'Great Falls'
    },
    'THOU': {
        'lat': 29.516,
        'lon': -95.242,
        'elev': 35.66158,
        'type': 'TDWR',
        'name': 'Houston Hobby'
    },
    'KDAX': {
        'lat': 38.50111,
        'lon': -121.67782,
        'elev': 9.14,
        'type': 'WSR-88D',
        'name': 'Sacramento'
    },
    'KTLX': {
        'lat': 35.33305,
        'lon': -97.27775,
        'elev': 369.72,
        'type': 'WSR-88D',
        'name': 'Oklahoma City'
    },
    'KTWX': {
        'lat': 38.99694,
        'lon': -96.23249,
        'elev': 416.66,
        'type': 'WSR-88D',
        'name': 'Topeka'
    },
    'PAEC': {
        'lat': 64.51139,
        'lon': -165.29498,
        'elev': 17.68,
        'type': 'WSR-88D',
        'name': 'Nome'
    },
    'TOKC': {
        'lat': 35.276,
        'lon': -97.51,
        'elev': 398.67838,
        'type': 'TDWR',
        'name': 'Oklahoma City'
    },
    'KEMX': {
        'lat': 31.89361,
        'lon': -110.63027,
        'elev': 1586.48,
        'type': 'WSR-88D',
        'name': 'Tucson'
    },
    'PHWA': {
        'lat': 19.095,
        'lon': -155.56887,
        'elev': 420.62,
        'type': 'WSR-88D',
        'name': 'South Hawaii'
    },
    'KFWS': {
        'lat': 32.57277,
        'lon': -97.30313,
        'elev': 212,
        'type': 'WSR-88D',
        'name': 'Dallas-Ft. Worth'
    },
    'TBOS': {
        'lat': 42.158,
        'lon': -70.933,
        'elev': 80.46718,
        'type': 'TDWR',
        'name': 'Boston'
    },
    'KUDX': {
        'lat': 44.12471,
        'lon': -102.82999,
        'elev': 939,
        'type': 'WSR-88D',
        'name': 'Rapid City'
    },
    'PHKI': {
        'lat': 21.89389,
        'lon': -159.55249,
        'elev': 69,
        'type': 'WSR-88D',
        'name': 'South Kauai'
    },
    'TRDU': {
        'lat': 36.002,
        'lon': -78.697,
        'elev': 156.97198,
        'type': 'TDWR',
        'name': 'Raleigh Durham'
    },
    'KMLB': {
        'lat': 28.11305,
        'lon': -80.6544399,
        'elev': 10.67,
        'type': 'WSR-88D',
        'name': 'Melbourne'
    },
    'KCYS': {
        'lat': 41.15194,
        'lon': -104.8061,
        'elev': 1867.81,
        'type': 'WSR-88D',
        'name': 'Cheyenne'
    },
    'KFFC': {
        'lat': 33.36333,
        'lon': -84.56583,
        'elev': 261.52,
        'type': 'WSR-88D',
        'name': 'Atlanta'
    },
    'AWPA2': {
        'lat': 61.15,
        'lon': -149.78,
        'elev': 97,
        'type': 'Profiler',
        'name': 'Anchorage'
    },
    'KVWX': {
        'lat': 38.26024,
        'lon': -87.72452,
        'elev': 155.75,
        'type': 'WSR-88D',
        'name': 'Evansville'
    },
    'KAPX': {
        'lat': 44.90634,
        'lon': -84.71953,
        'elev': 446.23,
        'type': 'WSR-88D',
        'name': 'Gaylord'
    },
    'KCCX': {
        'lat': 40.92305,
        'lon': -78.00389,
        'elev': 733.04,
        'type': 'WSR-88D',
        'name': 'State College'
    },
    'KBHX': {
        'lat': 40.49833,
        'lon': -124.29215,
        'elev': 732.13,
        'type': 'WSR-88D',
        'name': 'Eureka'
    },
    'KILN': {
        'lat': 39.42027,
        'lon': -83.82166,
        'elev': 321.87,
        'type': 'WSR-88D',
        'name': 'Wilmington'
    },
    'PGUA': {
        'lat': 13.45583,
        'lon': 144.81112,
        'elev': 83,
        'type': 'WSR-88D',
        'name': 'Anderson AFB'
    },
    'KCLE': {
        'lat': 41.41305,
        'lon': -81.86,
        'elev': 232.56,
        'type': 'WSR-88D',
        'name': 'Cleveland'
    },
    'KUEX': {
        'lat': 40.32083,
        'lon': -98.44194,
        'elev': 602.28,
        'type': 'WSR-88D',
        'name': 'Grand Island'
    },
    'PAPD': {
        'lat': 65.03511,
        'lon': -147.5014,
        'elev': 790.35,
        'type': 'WSR-88D',
        'name': 'Pedro Dome'
    },
    'TLKA2': {
        'lat': 62.31,
        'lon': -150.4199999,
        'elev': 151,
        'type': 'Profiler',
        'name': 'Talkeetna'
    },
    'KMHX': {
        'lat': 34.77583,
        'lon': -76.87639,
        'elev': 9.45,
        'type': 'WSR-88D',
        'name': 'Morehead City'
    },
    'KMBX': {
        'lat': 48.39249,
        'lon': -100.86443,
        'elev': 455.07,
        'type': 'WSR-88D',
        'name': 'Minot AFB'
    },
    'KTYX': {
        'lat': 43.75582,
        'lon': -75.68,
        'elev': 562.66,
        'type': 'WSR-88D',
        'name': 'Montague'
    },
    'KLGX': {
        'lat': 47.11689,
        'lon': -124.10663,
        'elev': 76.8,
        'type': 'WSR-88D',
        'name': 'Langley Hill'
    },

    'KULM': {
        'NONSTANDARD': true,
        'lat': 32.52944,
        'lon': -92.01222,
        'elev': 43,
        'type': 'N/A', // Polarimetric S-band Doppler
        'name': 'Monroe / ULM'
    },
    'WILU': {
        'NONSTANDARD': true,
        'lat': 40.46551,
        'lon': -90.68594,
        'elev': 212,
        'type': 'N/A',
        'name': 'Western Illinois University'
    },
    'FWLX': {
        'NONSTANDARD': true,
        'lat': 35.25498,
        'lon': -87.32543,
        'elev': 303,
        'type': 'N/A',
        'name': 'WLX X-Band'
    },
    'KHDC': {
        'lat': 30.51959991455078,
        'lon': -90.40740203857422,
        'elev': 47,
        'type': 'WSR-88D',
        'name': 'Hammond'
    },
}

module.exports = {
    get_nexrad_location,
    NEXRAD_LOCATIONS
};
},{}],12:[function(require,module,exports){
function dest_vincenty(start, distance, bearing) {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const b = a * (1 - f);
    const one_minus_f = 1 - f;

    if (distance === 0) {
        return [start.lng, start.lat];
    }

    const to_rad = deg => deg * Math.PI / 180;
    const to_deg = rad => rad * 180 / Math.PI;

    const φ1 = to_rad(start.lat);
    const λ1 = to_rad(start.lng);
    const α1 = to_rad(bearing);

    const sinα1 = Math.sin(α1), cosα1 = Math.cos(α1);

    const tanU1 = one_minus_f * Math.tan(φ1);
    const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
    const sinU1 = tanU1 * cosU1;

    const σ1 = Math.atan2(tanU1, cosα1);
    const sinα = cosU1 * sinα1;
    const cosSqα = 1 - sinα * sinα;

    const uSq = cosSqα * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

    const sOverBA = distance / (b * A);
    let σ = sOverBA + (f / 6.0) * sinα1 * tanU1 * sOverBA * sOverBA;

    const TOL = 3.0 * 1e-6;
    const MAX_ITER = 6;
    let sinσ, cosσ, cos2σm, Δσ;

    for (let i = 0; i < MAX_ITER; i++) {
        sinσ = Math.sin(σ);
        cosσ = Math.cos(σ);
        cos2σm = Math.cos(2 * σ1 + σ);

        const temp1 = cosσ * (-1 + 2 * cos2σm * cos2σm);
        const temp2 = cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm);
        Δσ = B * sinσ * (cos2σm + B / 4 * (temp1 - B / 6 * temp2));

        const sin2σm = Math.sin(2 * σ1 + σ);
        
        const dTemp1Dσ = -sinσ * (-1 + 2 * cos2σm * cos2σm) + cosσ * (-4 * cos2σm * sin2σm);
        const dTemp2Dσ = -sin2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)
            + cos2σm * (8 * sinσ * cosσ) * (-3 + 4 * cos2σm * cos2σm)
            + cos2σm * (-3 + 4 * sinσ * sinσ) * (-8 * cos2σm * sin2σm);

        const dΔσDσ = B * cosσ * (cos2σm + B / 4 * (temp1 - B / 6 * temp2))
            + B * sinσ * (-sin2σm + B / 4 * (dTemp1Dσ - B / 6 * dTemp2Dσ));

        const fσ = σ - distance / (b * A) - Δσ;
        const fPrimeσ = 1 - dΔσDσ;

        const ΔσNR = fσ / fPrimeσ;
        const σNew = σ - ΔσNR;

        if (Math.abs(ΔσNR) <= TOL) {
            σ = σNew;
            break;
        }

        σ = σNew;
    }

    sinσ = Math.sin(σ);
    cosσ = Math.cos(σ);
    cos2σm = Math.cos(2 * σ1 + σ);

    const x = sinU1 * sinσ - cosU1 * cosσ * cosα1;
    const φ2 = Math.atan2(
        sinU1 * cosσ + cosU1 * sinσ * cosα1,
        one_minus_f * Math.sqrt(sinα * sinα + x * x)
    );

    const λ = Math.atan2(
        sinσ * sinα1,
        cosU1 * cosσ - sinU1 * sinσ * cosα1
    );

    const C = f / 16 * cosSqα * (4 + f * (4 - 3 * cosSqα));
    const L = λ - one_minus_f * f * sinα * (
        σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm))
    );

    const lat2 = to_deg(φ2);
    const lng2 = to_deg(λ1 + L);

    return [lng2, lat2];
}

module.exports = dest_vincenty;

},{}],13:[function(require,module,exports){
/** Burrows-Wheeler transform, computed with the Induced Sorting Suffix Array
 *  construction mechanism (sais).  Code is a port of:
 *    https://sites.google.com/site/yuta256/sais
 *  which is:
 *    Copyright (c) 2008-2010 Yuta Mori All Rights Reserved.
 *  and licensed under an MIT/X11 license.  I generally looked at both
 *  the C and the Java implementations to guide my work.
 *
 * This JavaScript port is:
 *    Copyright (c) 2013 C. Scott Ananian
 * and licensed under GPLv2; see the README at the top level of this package.
 */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./freeze', './Util'], function(freeze, Util) {

const freeze = require('./freeze');
// const BWT = require('./BWT');
const Util = require('./Util');

    var ASSERT = console.assert.bind(console);

    // we're dispensing with the "arbitrary alphabet" stuff of the source
    // and just using Uint8Arrays.

    /** Find the start or end of each bucket. */
    var getCounts = function(T, C, n, k) {
        var i;
        for (i = 0; i < k; i++) { C[i] = 0; }
        for (i = 0; i < n; i++) { C[T[i]]++; }
    };
    var getBuckets = function(C, B, k, end) {
        var i, sum = 0;
        if (end) {
            for (i = 0; i < k; i++) { sum += C[i]; B[i] = sum; }
        } else {
            for (i = 0; i < k; i++) { sum += C[i]; B[i] = sum - C[i]; }
        }
    };

    /** Sort all type LMS suffixes */
    var LMSsort = function(T, SA, C, B, n, k) {
        var b, i, j;
        var c0, c1;
        /* compute SAl */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, false); /* find starts of buckets */
        j = n - 1;
        b = B[c1 = T[j]];
        j--;
        SA[b++] = (T[j] < c1) ? ~j : j;
        for (i = 0; i < n; i++) {
            if ((j = SA[i]) > 0) {
                ASSERT(T[j] >= T[j+1]);
                if ((c0 = T[j]) !== c1) { B[c1] = b; b = B[c1 = c0]; }
                ASSERT(i < b);
                j--;
                SA[b++] = (T[j] < c1) ? ~j : j;
                SA[i] = 0;
            } else if (j < 0) {
                SA[i] = ~j;
            }
        }
        /* compute SAs */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, 1); /* find ends of buckets */
        for (i = n-1, b = B[c1 = 0]; i >= 0; i--) {
            if ((j = SA[i]) > 0) {
                ASSERT(T[j] <= T[j+1]);
                if ((c0 = T[j]) !== c1) { B[c1] = b; b = B[c1 = c0]; }
                ASSERT(b <= i);
                j--;
                SA[--b] = (T[j] > c1) ? ~(j+1) : j;
                SA[i] = 0;
            }
        }
    };

    var LMSpostproc = function(T, SA, n, m) {
        var i, j, p, q, plen, qlen, name;
        var c0, c1;
        var diff;

        /* compact all the sorted substrings into the first m items of SA
         * 2*m must not be larger than n (provable) */
        ASSERT(n > 0);
        for (i = 0; (p = SA[i]) < 0; i++) { SA[i] = ~p; ASSERT((i+1) < n); }
        if (i < m) {
            for (j = i, i++; ; i++) {
                ASSERT(i < n);
                if ((p = SA[i]) < 0) {
                    SA[j++] = ~p; SA[i] = 0;
                    if (j === m) { break; }
                }
            }
        }

        /* store the length of all substrings */
        c0 = T[i = j = n - 1];
        do { c1 = c0; } while ( ((--i) >= 0 ) && ((c0=T[i]) >= c1) );
        for (; i >= 0; ) {
            do { c1 = c0; } while ( ((--i) >= 0 ) && ((c0=T[i]) <= c1) );
            if (i >= 0) {
                SA[m + ((i + 1) >>> 1)] = j - i; j = i + 1;
                do { c1 = c0; } while ( ((--i) >= 0 ) && ((c0=T[i]) >= c1) );
            }
        }

        /* find the lexicographic names of all substrings */
        for (i = 0, name = 0, q = n, qlen = 0; i < m; i++) {
            p = SA[i]; plen = SA[m + (p >>> 1)]; diff = true;
            if ((plen === qlen) && ((q + plen) < n)) {
                for (j = 0; (j < plen) && (T[p + j] === T[q + j]); ) { j++; }
                if (j === plen) { diff = false; }
            }
            if (diff) { name++; q = p; qlen = plen; }
            SA[m + (p >>> 1)] = name;
        }

        return name;
    };

    /* compute SA and BWT */
    var induceSA = function(T, SA, C, B, n, k) {
        var b, i, j;
        var c0, c1;
        /* compute SAl */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, false); /* find starts of buckets */
        j = n - 1;
        b = B[c1 = T[j]];
        SA[b++] = ((j > 0) && (T[j-1] < c1)) ? ~j : j;
        for (i = 0; i < n; i++) {
            j = SA[i]; SA[i] = ~j;
            if (j > 0) {
                j--;
                ASSERT( T[j] >= T[j + 1] );
                if ((c0 = T[j]) !== c1) { B[c1]  = b; b = B[c1=c0]; }
                ASSERT( i < b );
                SA[b++] = ((j > 0) && (T[j-1] < c1)) ? ~j : j;
            }
        }
        /* compute SAs */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, true); /* find ends of buckets */
        for (i = n-1, b = B[c1 = 0]; i >= 0; i--) {
            if ((j = SA[i]) > 0) {
                j--;
                ASSERT( T[j] <= T[j + 1] );
                if ((c0 = T[j]) !== c1) { B[c1] = b; b = B[c1 = c0]; }
                ASSERT( b <= i );
                SA[--b] = ((j === 0) || (T[j - 1] > c1)) ? ~j : j;
            } else {
                SA[i] = ~j;
            }
        }
    };

    var computeBWT = function(T, SA, C, B, n, k) {
        var b, i, j, pidx = -1;
        var c0, c1;
        /* compute SAl */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, false); /* find starts of buckets */
        j = n - 1;
        b = B[c1 = T[j]];
        SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
        for (i = 0; i < n; i++) {
            if ((j=SA[i]) > 0) {
                j--;
                ASSERT( T[j] >= T[j+1] );
                SA[i] = ~(c0 = T[j]);
                if (c0 !== c1) { B[c1] = b; b = B[c1 = c0]; }
                ASSERT( i < b );
                SA[b++] = ((j > 0) && (T[j - 1] < c1)) ? ~j : j;
            } else if (j !== 0) {
                SA[i] = ~j;
            }
        }
        /* compute SAs */
        if (C === B) { getCounts(T, C, n, k); }
        getBuckets(C, B, k, true); /* find ends of buckets */
        for (i = n-1, b = B[c1 = 0]; i >= 0; i--) {
            if ((j = SA[i]) > 0) {
                j--;
                ASSERT( T[j] <= T[j+1] );
                SA[i] = c0 = T[j];
                if (c0 !== c1) { B[c1] = b; b = B[c1 = c0]; }
                ASSERT( b <= i );
                SA[--b] = ((j > 0) && (T[j-1] > c1)) ? (~T[j-1]) : j;
            } else if (j !== 0) {
                SA[i] = ~j;
            } else {
                pidx = i;
            }
        }
        return pidx;
    };

    /* find the suffix array SA of T[0..n-1] in {0..k-1}^n
       use a working space (excluding T and SA) of at most 2n+O(1) for a
       constant alphabet */
    var SA_IS = function(T, SA, fs, n, k, isbwt) {
        var C, B, RA;
        var i, j, b, c, m, p, q, name, pidx = 0, newfs;
        var c0, c1;
        var flags = 0;

        // allocate temporary storage [CSA]
        if (k <= 256) {
            C = Util.makeS32Buffer(k);
            if (k <= fs) { B = SA.subarray(n + fs - k); flags = 1; }
            else { B = Util.makeS32Buffer(k); flags = 3; }
        } else if (k <= fs) {
            C = SA.subarray(n + fs - k);
            if (k <= (fs - k)) { B = SA.subarray(n + fs - k * 2); flags = 0; }
            else if (k <= 1024) { B = Util.makeS32Buffer(k); flags = 2; }
            else { B = C; flags = 8; }
        } else {
            C = B = Util.makeS32Buffer(k);
            flags = 4 | 8;
        }

        /* stage 1: reduce the problem by at least 1/2
           sort all the LMS-substrings */
        getCounts(T, C, n, k);
        getBuckets(C, B, k, true); /* find ends of buckets */
        for (i = 0; i < n; i++) { SA[i] = 0; }
        b = -1; i = n - 1; j = n; m = 0; c0 = T[n - 1];
        do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
        for (; i >= 0 ;) {
            do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) <= c1));
            if ( i >= 0 ) {
                if ( b >= 0 ) { SA[b] = j; }
                b = --B[c1];
                j = i;
                ++m;
                do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
            }
        }

        if (m > 1) {
            LMSsort(T, SA, C, B, n, k);
            name = LMSpostproc(T, SA, n, m);
        } else if (m === 1) {
            SA[b] = j + 1;
            name = 1;
        } else {
            name = 0;
        }

        /* stage 2: solve the reduced problem
           recurse if names are not yet unique */
        if(name < m) {
            if((flags & 4) !== 0) { C = null; B = null; }
            if((flags & 2) !== 0) { B = null; }
            newfs = (n + fs) - (m * 2);
            if((flags & (1 | 4 | 8)) === 0) {
                if((k + name) <= newfs) { newfs -= k; }
                else { flags |= 8; }
            }
            ASSERT( (n >>> 1) <= (newfs + m) );
            for (i = m + (n >>> 1) - 1, j = m * 2 + newfs - 1; m <= i; i--) {
                if(SA[i] !== 0) { SA[j--] = SA[i] - 1; }
            }
            RA = SA.subarray(m + newfs);
            SA_IS(RA, SA, newfs, m, name, false);
            RA = null;

            i = n - 1; j = m * 2 - 1; c0 = T[n - 1];
            do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
            for (; i >= 0 ;) {
                do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) <= c1));
                if ( i >= 0 ) {
                    SA[j--] = i + 1;
                    do { c1 = c0; } while ((--i >= 0) && ((c0 = T[i]) >= c1));
                }
            }

            for (i = 0; i < m; i++) { SA[i] = SA[m + SA[i]]; }
            if((flags & 4) !== 0) { C = B = Util.makeS32Buffer(k); }
            if((flags & 2) !== 0) { B = Util.makeS32Buffer(k); }
        }

        /* stage 3: induce the result for the original problem */
        if((flags & 8) !== 0) { getCounts(T, C, n, k); }
        /* put all left-most S characters into their buckets */
        if (m > 1) {
            getBuckets(C, B, k, true); /* find ends of buckets */
            i = m - 1; j = n; p = SA[m - 1]; c1 = T[p];
            do {
                q = B[c0 = c1];
                while (q < j) { SA[--j] = 0; }
                do {
                    SA[--j] = p;
                    if(--i < 0) { break; }
                    p = SA[i];
                } while((c1 = T[p]) === c0);
            } while (i >= 0 );
            while ( j > 0 ) { SA[--j] = 0; }
        }
        if (!isbwt) { induceSA(T, SA, C, B, n, k); }
        else { pidx = computeBWT(T, SA, C, B, n, k); }
        C = null; B = null;
        return pidx;
    };

    var BWT = Object.create(null);
    /** SA should be a Int32Array (signed!); T can be any typed array.
     *  alphabetSize is optional if T is an Uint8Array or Uint16Array. */
    BWT.suffixsort = function(T, SA, n, alphabetSize) {
        ASSERT( T && SA && T.length >= n && SA.length >= n );
        if (n <= 1) {
            if (n === 1) { SA[0] = 0; }
            return 0;
        }
        if (!alphabetSize) {
            if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; }
            else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; }
            else throw new Error('Need to specify alphabetSize');
        }
        ASSERT( alphabetSize > 0 );
        if (T.BYTES_PER_ELEMENT) {
            ASSERT( alphabetSize <= (1 << (T.BYTES_PER_ELEMENT*8) ) );
        }
        return SA_IS(T, SA, 0, n, alphabetSize, false);
    };
    /** Burrows-Wheeler Transform.
        A should be Int32Array (signed!); T can be any typed array.
        U is the same type as T (it is used for output).
        alphabetSize is optional if T is an Uint8Array or Uint16Array.
        ASSUMES STRING IS TERMINATED WITH AN EOF CHARACTER.
    */
    BWT.bwtransform = function(T, U, A, n, alphabetSize) {
        var i, pidx;
        ASSERT( T && U && A );
        ASSERT( T.length >= n && U.length >= n && A.length >= n );
        if (n <= 1) {
            if (n === 1) { U[0] = T[0]; }
            return n;
        }
        if (!alphabetSize) {
            if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; }
            else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; }
            else throw new Error('Need to specify alphabetSize');
        }
        ASSERT( alphabetSize > 0 );
        if (T.BYTES_PER_ELEMENT) {
            ASSERT( alphabetSize <= (1 << (T.BYTES_PER_ELEMENT*8) ) );
        }
        pidx = SA_IS(T, A, 0, n, alphabetSize, true);
        U[0] = T[n - 1];
        for (i = 0; i < pidx ; i++) { U[i + 1] = A[i]; }
        for (i += 1; i < n; i++) { U[i] = A[i]; }
        return pidx + 1;
    };
    /** Reverses transform above. (ASSUMED STRING IS TERMINATED WITH EOF.) */
    BWT.unbwtransform = function(T, U, LF, n, pidx) {
        var C = Util.makeU32Buffer(256);
        var i, t;
        for (i=0; i<256; i++) { C[i] = 0; }
        for (i=0; i<n; i++) { LF[i] = C[T[i]]++; }
        for (i=0, t=0; i<256; i++) { t += C[i]; C[i] = t - C[i]; }
        for (i=n-1, t=0; i>=0; i--) {
            t = LF[t] + C[U[i]=T[t]];
            t += (t<pidx) ? 1 : 0;
        }
        C = null;
    };

    /** Burrows-Wheeler Transform.
        A should be Int32Array (signed!); T can be any typed array.
        U is the same type as T (it is used for output).
        alphabetSize is optional if T is an Uint8Array or Uint16Array.
        ASSUMES STRING IS CYCLIC.
        (XXX: this is twice as inefficient as I'd like! [CSA])
    */
    BWT.bwtransform2 = function(T, U, n, alphabetSize) {
        var i, j, pidx = 0;
        ASSERT( T && U );
        ASSERT( T.length >= n && U.length >= n );
        if (n <= 1) {
            if (n === 1) { U[0] = T[0]; }
            return 0;
        }
        if (!alphabetSize) {
            if (T.BYTES_PER_ELEMENT === 1) { alphabetSize = 256; }
            else if (T.BYTES_PER_ELEMENT === 2) { alphabetSize = 65536; }
            else throw new Error('Need to specify alphabetSize');
        }
        ASSERT( alphabetSize > 0 );
        if (T.BYTES_PER_ELEMENT) {
            ASSERT( alphabetSize <= (1 << (T.BYTES_PER_ELEMENT*8) ) );
        }
        // double length of T
        var TT;
        if (T.length >= n*2) {
            TT = T; // do it in place if possible
        } else if (alphabetSize <= 256) {
            TT = Util.makeU8Buffer(n*2);
        } else if (alphabetSize <= 65536) {
            TT = Util.makeU16Buffer(n*2);
        } else {
            TT = Util.makeU32Buffer(n*2);
        }
        if (TT!==T) {
            for (i=0; i<n; i++) { TT[i] = T[i]; }
        }
        for (i=0; i<n; i++) { TT[n+i] = TT[i]; }
        // sort doubled string
        var A = Util.makeS32Buffer(n*2);
        SA_IS(TT, A, 0, n*2, alphabetSize, false);
        for (i=0, j=0; i<2*n; i++) {
            var s = A[i];
            if (s < n) {
                if (s === 0) { pidx = j; }
                if (--s < 0) { s = n-1; }
                U[j++] = T[s];
            }
        }
        ASSERT(j===n);
        return pidx;
    };

    // return freeze(BWT);
    module.exports = freeze(BWT);
// });

},{"./Util":19,"./freeze":20}],14:[function(require,module,exports){
/** Big-Endian Bit Stream, implemented on top of a (normal byte) stream. */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
const Stream = require('./Stream');

// define(['./Stream'],function(Stream) {

    var BitStream = function(stream) {
        (function() {
            var bufferByte = 0x100; // private var for readers
            this.readBit = function() {
                if ((bufferByte & 0xFF) === 0) {
                    var ch = stream.readByte();
                    if (ch === Stream.EOF) {
                        this._eof = true;
                        return ch; /* !!! */
                    }
                    bufferByte = (ch << 1) | 1;
                }
                var bit = (bufferByte & 0x100) ? 1 : 0;
                bufferByte <<= 1;
                return bit;
            };
            // seekable iff the provided stream is
            this.seekBit = function(pos) {
                var n_byte = pos >>> 3;
                var n_bit = pos - (n_byte*8);
                this.seek(n_byte);
                this._eof = false;
                this.readBits(n_bit);
            };
            this.tellBit = function() {
                var pos = stream.tell() * 8;
                var b = bufferByte;
                while ((b & 0xFF) !== 0) {
                    pos--;
                    b <<= 1;
                }
                return pos;
            };
            // implement byte stream interface as well.
            this.readByte = function() {
                if ((bufferByte & 0xFF) === 0) {
                    return stream.readByte();
                }
                return this.readBits(8);
            };
            this.seek = function(pos) {
                stream.seek(pos);
                bufferByte = 0x100;
            };
        }).call(this);
        (function() {
            var bufferByte = 1; // private var for writers
            this.writeBit = function(b) {
                bufferByte <<= 1;
                if (b) { bufferByte |= 1; }
                if (bufferByte & 0x100) {
                    stream.writeByte(bufferByte & 0xFF);
                    bufferByte = 1;
                }
            };
            // implement byte stream interface as well
            this.writeByte = function(_byte) {
                if (bufferByte===1) {
                    stream.writeByte(_byte);
                } else {
                    stream.writeBits(8, _byte);
                }
            };
            this.flush = function() {
                while (bufferByte !== 1) {
                    this.writeBit(0);
                }
                if (stream.flush) { stream.flush(); }
            };
        }).call(this);
    };
    // inherit read/write methods from Stream.
    BitStream.EOF = Stream.EOF;
    BitStream.prototype = Object.create(Stream.prototype);
    // bit chunk read/write
    BitStream.prototype.readBits = function(n) {
        var i, r = 0, b;
        if (n > 31) {
            r = this.readBits(n-16)*0x10000; // fp multiply, not shift
            return r + this.readBits(16);
        }
        for (i = 0; i < n; i++) {
            r <<= 1; // this could make a negative value if n>31
            // bits read past EOF are all zeros!
            if (this.readBit() > 0) { r++; }
        }
        return r;
    };
    BitStream.prototype.writeBits = function(n, value) {
        if (n > 32) {
            var low = (value & 0xFFFF);
            var high = (value - low) / (0x10000); // fp division, not shift
            this.writeBits(n-16, high);
            this.writeBits(16, low);
            return;
        }
        var i;
        for (i = n-1; i >= 0; i--) {
            this.writeBit( (value >>> i) & 1 );
        }
    };

    // return BitStream;
    module.exports = BitStream;
// });

},{"./Stream":18}],15:[function(require,module,exports){
/*
An implementation of Bzip2 de/compression, including the ability to
seek within bzip2 data.

Copyright (C) 2013 C. Scott Ananian
Copyright (C) 2012 Eli Skeggs
Copyright (C) 2011 Kevin Kwok

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 2.1 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public
License along with this library; if not, see
http://www.gnu.org/licenses/lgpl-2.1.html

Adapted from node-bzip, copyright 2012 Eli Skeggs.
Adapted from bzip2.js, copyright 2011 Kevin Kwok (antimatter15@gmail.com).

Based on micro-bunzip by Rob Landley (rob@landley.net).

Based on bzip2 decompression code by Julian R Seward (jseward@acm.org),
which also acknowledges contributions by Mike Burrows, David Wheeler,
Peter Fenwick, Alistair Moffat, Radford Neal, Ian H. Witten,
Robert Sedgewick, and Jon L. Bentley.

BWT implementation based on work by Yuta Mori; see BWT.js for details.

bzip2 compression code inspired by https://code.google.com/p/jbzip2
*/
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./freeze','./BitStream','./BWT','./CRC32','./HuffmanAllocator','./Stream','./Util'], function(freeze, BitStream, BWT, CRC32, HuffmanAllocator, Stream, Util) {

const freeze = require('./freeze');
const BitStream = require('./BitStream');
const BWT = require('./BWT');
const CRC32 = require('./CRC32');
const HuffmanAllocator = require('./HuffmanAllocator');
const Stream = require('./Stream');
const Util = require('./Util');

var MAX_HUFCODE_BITS = 20;
var MAX_SYMBOLS = 258;
var SYMBOL_RUNA = 0;
var SYMBOL_RUNB = 1;
var MIN_GROUPS = 2;
var MAX_GROUPS = 6;
var GROUP_SIZE = 50;

var WHOLEPI = 0x314159265359; // 48-bit integer
var SQRTPI =  0x177245385090; // 48-bit integer

var EOF = Stream.EOF;

var mtf = function(array, index) {
  var src = array[index], i;
  for (i = index; i > 0; i--) {
    array[i] = array[i-1];
  }
  array[0] = src;
  return src;
};

var Err = {
  OK: 0,
  LAST_BLOCK: -1,
  NOT_BZIP_DATA: -2,
  UNEXPECTED_INPUT_EOF: -3,
  UNEXPECTED_OUTPUT_EOF: -4,
  DATA_ERROR: -5,
  OUT_OF_MEMORY: -6,
  OBSOLETE_INPUT: -7,
  END_OF_BLOCK: -8
};
var ErrorMessages = {};
ErrorMessages[Err.LAST_BLOCK] =            "Bad file checksum";
ErrorMessages[Err.NOT_BZIP_DATA] =         "Not bzip data";
ErrorMessages[Err.UNEXPECTED_INPUT_EOF] =  "Unexpected input EOF";
ErrorMessages[Err.UNEXPECTED_OUTPUT_EOF] = "Unexpected output EOF";
ErrorMessages[Err.DATA_ERROR] =            "Data error";
ErrorMessages[Err.OUT_OF_MEMORY] =         "Out of memory";
ErrorMessages[Err.OBSOLETE_INPUT] = "Obsolete (pre 0.9.5) bzip format not supported.";

var _throw = function(status, optDetail) {
  var msg = ErrorMessages[status] || 'unknown error';
  if (optDetail) { msg += ': '+optDetail; }
  var e = new TypeError(msg);
  e.errorCode = status;
  throw e;
};

var Bunzip = function(inputStream, outputStream) {
  this.writePos = this.writeCurrent = this.writeCount = 0;

  this._start_bunzip(inputStream, outputStream);
};
Bunzip.prototype._init_block = function() {
  var moreBlocks = this._get_next_block();
  if ( !moreBlocks ) {
    this.writeCount = -1;
    return false; /* no more blocks */
  }
  this.blockCRC = new CRC32();
  return true;
};
/* XXX micro-bunzip uses (inputStream, inputBuffer, len) as arguments */
Bunzip.prototype._start_bunzip = function(inputStream, outputStream) {
  /* Ensure that file starts with "BZh['1'-'9']." */
  var buf = Util.makeU8Buffer(4);
  if (inputStream.read(buf, 0, 4) !== 4 ||
      String.fromCharCode(buf[0], buf[1], buf[2]) !== 'BZh')
    _throw(Err.NOT_BZIP_DATA, 'bad magic');

  var level = buf[3] - 0x30;
  if (level < 1 || level > 9)
    _throw(Err.NOT_BZIP_DATA, 'level out of range');

  this.reader = new BitStream(inputStream);

  /* Fourth byte (ascii '1'-'9'), indicates block size in units of 100k of
     uncompressed data.  Allocate intermediate buffer for block. */
  this.dbufSize = 100000 * level;
  this.nextoutput = 0;
  this.outputStream = outputStream;
  this.streamCRC = 0;
};
Bunzip.prototype._get_next_block = function() {
  var i, j, k;
  var reader = this.reader;
  // this is get_next_block() function from micro-bunzip:
  /* Read in header signature and CRC, then validate signature.
     (last block signature means CRC is for whole file, return now) */
  var h = reader.readBits(48);
  if (h === SQRTPI) { // last block
    return false; /* no more blocks */
  }
  if (h !== WHOLEPI)
    _throw(Err.NOT_BZIP_DATA);
  this.targetBlockCRC = reader.readBits(32);
  this.streamCRC = (this.targetBlockCRC ^
                    ((this.streamCRC << 1) | (this.streamCRC>>>31))) >>> 0;
  /* We can add support for blockRandomised if anybody complains.  There was
     some code for this in busybox 1.0.0-pre3, but nobody ever noticed that
     it didn't actually work. */
  if (reader.readBits(1))
    _throw(Err.OBSOLETE_INPUT);
  var origPointer = reader.readBits(24);
  if (origPointer > this.dbufSize)
    _throw(Err.DATA_ERROR, 'initial position out of bounds');
  /* mapping table: if some byte values are never used (encoding things
     like ASCII text), the compression code removes the gaps to have fewer
     symbols to deal with, and writes a sparse bitfield indicating which
     values were present.  We make a translation table to convert the symbols
     back to the corresponding bytes. */
  var t = reader.readBits(16);
  var symToByte = Util.makeU8Buffer(256), symTotal = 0;
  for (i = 0; i < 16; i++) {
    if (t & (1 << (0xF - i))) {
      var o = i * 16;
      k = reader.readBits(16);
      for (j = 0; j < 16; j++)
        if (k & (1 << (0xF - j)))
          symToByte[symTotal++] = o + j;
    }
  }

  /* How many different Huffman coding groups does this block use? */
  var groupCount = reader.readBits(3);
  if (groupCount < MIN_GROUPS || groupCount > MAX_GROUPS)
    _throw(Err.DATA_ERROR);
  /* nSelectors: Every GROUP_SIZE many symbols we select a new Huffman coding
     group.  Read in the group selector list, which is stored as MTF encoded
     bit runs.  (MTF=Move To Front, as each value is used it's moved to the
     start of the list.) */
  var nSelectors = reader.readBits(15);
  if (nSelectors === 0)
    _throw(Err.DATA_ERROR);

  var mtfSymbol = Util.makeU8Buffer(256);
  for (i = 0; i < groupCount; i++)
    mtfSymbol[i] = i;

  var selectors = Util.makeU8Buffer(nSelectors); // was 32768...

  for (i = 0; i < nSelectors; i++) {
    /* Get next value */
    for (j = 0; reader.readBits(1); j++)
      if (j >= groupCount) _throw(Err.DATA_ERROR);
    /* Decode MTF to get the next selector */
    selectors[i] = mtf(mtfSymbol, j);
  }

  /* Read the Huffman coding tables for each group, which code for symTotal
     literal symbols, plus two run symbols (RUNA, RUNB) */
  var symCount = symTotal + 2;
  var groups = [], hufGroup;
  for (j = 0; j < groupCount; j++) {
    var length = Util.makeU8Buffer(symCount), temp = Util.makeU16Buffer(MAX_HUFCODE_BITS + 1);
    /* Read Huffman code lengths for each symbol.  They're stored in
       a way similar to MTF; record a starting value for the first symbol,
       and an offset from the previous value for every symbol after that. */
    t = reader.readBits(5); // lengths
    for (i = 0; i < symCount; i++) {
      for (;;) {
        if (t < 1 || t > MAX_HUFCODE_BITS) _throw(Err.DATA_ERROR);
        /* If first bit is 0, stop.  Else second bit indicates whether
           to increment or decrement the value. */
        if(!reader.readBits(1))
          break;
        if(!reader.readBits(1))
          t++;
        else
          t--;
      }
      length[i] = t;
    }

    /* Find largest and smallest lengths in this group */
    var minLen,  maxLen;
    minLen = maxLen = length[0];
    for (i = 1; i < symCount; i++) {
      if (length[i] > maxLen)
        maxLen = length[i];
      else if (length[i] < minLen)
        minLen = length[i];
    }

    /* Calculate permute[], base[], and limit[] tables from length[].
     *
     * permute[] is the lookup table for converting Huffman coded symbols
     * into decoded symbols.  base[] is the amount to subtract from the
     * value of a Huffman symbol of a given length when using permute[].
     *
     * limit[] indicates the largest numerical value a symbol with a given
     * number of bits can have.  This is how the Huffman codes can vary in
     * length: each code with a value>limit[length] needs another bit.
     */
    hufGroup = {};
    groups.push(hufGroup);
    hufGroup.permute = Util.makeU16Buffer(MAX_SYMBOLS);
    hufGroup.limit = Util.makeU32Buffer(MAX_HUFCODE_BITS + 2);
    hufGroup.base = Util.makeU32Buffer(MAX_HUFCODE_BITS + 1);
    hufGroup.minLen = minLen;
    hufGroup.maxLen = maxLen;
    /* Calculate permute[].  Concurrently, initialize temp[] and limit[]. */
    var pp = 0;
    for (i = minLen; i <= maxLen; i++) {
      temp[i] = hufGroup.limit[i] = 0;
      for (t = 0; t < symCount; t++)
        if (length[t] === i)
          hufGroup.permute[pp++] = t;
    }
    /* Count symbols coded for at each bit length */
    for (i = 0; i < symCount; i++)
      temp[length[i]]++;
    /* Calculate limit[] (the largest symbol-coding value at each bit
     * length, which is (previous limit<<1)+symbols at this level), and
     * base[] (number of symbols to ignore at each bit length, which is
     * limit minus the cumulative count of symbols coded for already). */
    pp = t = 0;
    for (i = minLen; i < maxLen; i++) {
      pp += temp[i];
      /* We read the largest possible symbol size and then unget bits
         after determining how many we need, and those extra bits could
         be set to anything.  (They're noise from future symbols.)  At
         each level we're really only interested in the first few bits,
         so here we set all the trailing to-be-ignored bits to 1 so they
         don't affect the value>limit[length] comparison. */
      hufGroup.limit[i] = pp - 1;
      pp <<= 1;
      t += temp[i];
      hufGroup.base[i + 1] = pp - t;
    }
    hufGroup.limit[maxLen + 1] = Number.MAX_VALUE; /* Sentinel value for reading next sym. */
    hufGroup.limit[maxLen] = pp + temp[maxLen] - 1;
    hufGroup.base[minLen] = 0;
  }
  /* We've finished reading and digesting the block header.  Now read this
     block's Huffman coded symbols from the file and undo the Huffman coding
     and run length encoding, saving the result into dbuf[dbufCount++]=uc */

  /* Initialize symbol occurrence counters and symbol Move To Front table */
  var byteCount = Util.makeU32Buffer(256);
  for (i = 0; i < 256; i++)
    mtfSymbol[i] = i;
  /* Loop through compressed symbols. */
  var runPos = 0, dbufCount = 0, selector = 0, uc;
  var dbuf = this.dbuf = Util.makeU32Buffer(this.dbufSize);
  symCount = 0;
  for (;;) {
    /* Determine which Huffman coding group to use. */
    if (!(symCount--)) {
      symCount = GROUP_SIZE - 1;
      if (selector >= nSelectors) { _throw(Err.DATA_ERROR); }
      hufGroup = groups[selectors[selector++]];
    }
    /* Read next Huffman-coded symbol. */
    i = hufGroup.minLen;
    j = reader.readBits(i);
    for (;;i++) {
      if (i > hufGroup.maxLen) { _throw(Err.DATA_ERROR); }
      if (j <= hufGroup.limit[i])
        break;
      j = (j << 1) | reader.readBits(1);
    }
    /* Huffman decode value to get nextSym (with bounds checking) */
    j -= hufGroup.base[i];
    if (j < 0 || j >= MAX_SYMBOLS) { _throw(Err.DATA_ERROR); }
    var nextSym = hufGroup.permute[j];
    /* We have now decoded the symbol, which indicates either a new literal
       byte, or a repeated run of the most recent literal byte.  First,
       check if nextSym indicates a repeated run, and if so loop collecting
       how many times to repeat the last literal. */
    if (nextSym === SYMBOL_RUNA || nextSym === SYMBOL_RUNB) {
      /* If this is the start of a new run, zero out counter */
      if (!runPos){
        runPos = 1;
        t = 0;
      }
      /* Neat trick that saves 1 symbol: instead of or-ing 0 or 1 at
         each bit position, add 1 or 2 instead.  For example,
         1011 is 1<<0 + 1<<1 + 2<<2.  1010 is 2<<0 + 2<<1 + 1<<2.
         You can make any bit pattern that way using 1 less symbol than
         the basic or 0/1 method (except all bits 0, which would use no
         symbols, but a run of length 0 doesn't mean anything in this
         context).  Thus space is saved. */
      if (nextSym === SYMBOL_RUNA)
        t += runPos;
      else
        t += 2 * runPos;
      runPos <<= 1;
      continue;
    }
    /* When we hit the first non-run symbol after a run, we now know
       how many times to repeat the last literal, so append that many
       copies to our buffer of decoded symbols (dbuf) now.  (The last
       literal used is the one at the head of the mtfSymbol array.) */
    if (runPos){
      runPos = 0;
      if (dbufCount + t > this.dbufSize) { _throw(Err.DATA_ERROR); }
      uc = symToByte[mtfSymbol[0]];
      byteCount[uc] += t;
      while (t--)
        dbuf[dbufCount++] = uc;
    }
    /* Is this the terminating symbol? */
    if (nextSym > symTotal)
      break;
    /* At this point, nextSym indicates a new literal character.  Subtract
       one to get the position in the MTF array at which this literal is
       currently to be found.  (Note that the result can't be -1 or 0,
       because 0 and 1 are RUNA and RUNB.  But another instance of the
       first symbol in the MTF array, position 0, would have been handled
       as part of a run above.  Therefore 1 unused MTF position minus
       2 non-literal nextSym values equals -1.) */
    if (dbufCount >= this.dbufSize) { _throw(Err.DATA_ERROR); }
    i = nextSym - 1;
    uc = mtf(mtfSymbol, i);
    uc = symToByte[uc];
    /* We have our literal byte.  Save it into dbuf. */
    byteCount[uc]++;
    dbuf[dbufCount++] = uc;
  }
  /* At this point, we've read all the Huffman-coded symbols (and repeated
     runs) for this block from the input stream, and decoded them into the
     intermediate buffer.  There are dbufCount many decoded bytes in dbuf[].
     Now undo the Burrows-Wheeler transform on dbuf.
     See http://dogma.net/markn/articles/bwt/bwt.htm
  */
  if (origPointer < 0 || origPointer >= dbufCount) { _throw(Err.DATA_ERROR); }
  /* Turn byteCount into cumulative occurrence counts of 0 to n-1. */
  j = 0;
  for (i = 0; i < 256; i++) {
    k = j + byteCount[i];
    byteCount[i] = j;
    j = k;
  }
  /* Figure out what order dbuf would be in if we sorted it. */
  for (i = 0; i < dbufCount; i++) {
    uc = dbuf[i] & 0xff;
    dbuf[byteCount[uc]] |= (i << 8);
    byteCount[uc]++;
  }
  /* Decode first byte by hand to initialize "previous" byte.  Note that it
     doesn't get output, and if the first three characters are identical
     it doesn't qualify as a run (hence writeRunCountdown=5). */
  var pos = 0, current = 0, run = 0;
  if (dbufCount) {
    pos = dbuf[origPointer];
    current = (pos & 0xff);
    pos >>= 8;
    run = -1;
  }
  this.writePos = pos;
  this.writeCurrent = current;
  this.writeCount = dbufCount;
  this.writeRun = run;

  return true; /* more blocks to come */
};
/* Undo burrows-wheeler transform on intermediate buffer to produce output.
   If start_bunzip was initialized with out_fd=-1, then up to len bytes of
   data are written to outbuf.  Return value is number of bytes written or
   error (all errors are negative numbers).  If out_fd!=-1, outbuf and len
   are ignored, data is written to out_fd and return is RETVAL_OK or error.
*/
Bunzip.prototype._read_bunzip = function(outputBuffer, len) {
    var copies, previous, outbyte;
    /* james@jamestaylor.org: writeCount goes to -1 when the buffer is fully
       decoded, which results in this returning RETVAL_LAST_BLOCK, also
       equal to -1... Confusing, I'm returning 0 here to indicate no
       bytes written into the buffer */
  if (this.writeCount < 0) { return 0; }

  var gotcount = 0;
  var dbuf = this.dbuf, pos = this.writePos, current = this.writeCurrent;
  var dbufCount = this.writeCount, outputsize = this.outputsize;
  var run = this.writeRun;

  while (dbufCount) {
    dbufCount--;
    previous = current;
    pos = dbuf[pos];
    current = pos & 0xff;
    pos >>= 8;
    if (run++ === 3){
      copies = current;
      outbyte = previous;
      current = -1;
    } else {
      copies = 1;
      outbyte = current;
    }
    this.blockCRC.updateCRCRun(outbyte, copies);
    while (copies--) {
      this.outputStream.writeByte(outbyte);
      this.nextoutput++;
    }
    if (current != previous)
      run = 0;
  }
  this.writeCount = dbufCount;
  // check CRC
  if (this.blockCRC.getCRC() !== this.targetBlockCRC) {
    _throw(Err.DATA_ERROR, "Bad block CRC "+
           "(got "+this.blockCRC.getCRC().toString(16)+
           " expected "+this.targetBlockCRC.toString(16)+")");
  }
  return this.nextoutput;
};

/* Static helper functions */
Bunzip.Err = Err;
// 'input' can be a stream or a buffer
// 'output' can be a stream or a buffer or a number (buffer size)
Bunzip.decode = function(input, output, multistream) {
  // make a stream from a buffer, if necessary
  var inputStream = Util.coerceInputStream(input);
  var o = Util.coerceOutputStream(output, output);
  var outputStream = o.stream;

  var bz = new Bunzip(inputStream, outputStream);
  while (true) {
    if ('eof' in inputStream && inputStream.eof()) break;
    if (bz._init_block()) {
      bz._read_bunzip();
    } else {
      var targetStreamCRC = bz.reader.readBits(32);
      if (targetStreamCRC !== bz.streamCRC) {
        _throw(Err.DATA_ERROR, "Bad stream CRC "+
               "(got "+bz.streamCRC.toString(16)+
               " expected "+targetStreamCRC.toString(16)+")");
      }
      if (multistream &&
          'eof' in inputStream &&
          !inputStream.eof()) {
        // note that start_bunzip will also resync the bit reader to next byte
        bz._start_bunzip(inputStream, outputStream);
      } else break;
    }
  }
  return o.retval;
};
Bunzip.decodeBlock = function(input, pos, output) {
  // make a stream from a buffer, if necessary
  var inputStream = Util.coerceInputStream(input);
  var o = Util.coerceOutputStream(output, output);
  var outputStream = o.stream;
  var bz = new Bunzip(inputStream, outputStream);
  bz.reader.seekBit(pos);
  /* Fill the decode buffer for the block */
  var moreBlocks = bz._get_next_block();
  if (moreBlocks) {
    /* Init the CRC for writing */
    bz.blockCRC = new CRC32();

    /* Zero this so the current byte from before the seek is not written */
    bz.writeCopies = 0;

    /* Decompress the block and write to stdout */
    bz._read_bunzip();
    // XXX keep writing?
  }
  return o.retval;
};
/* Reads bzip2 file from stream or buffer `input`, and invoke
 * `callback(position, size)` once for each bzip2 block,
 * where position gives the starting position (in *bits*)
 * and size gives uncompressed size of the block (in *bytes*). */
Bunzip.table = function(input, callback, multistream) {
  // make a stream from a buffer, if necessary
  var inputStream = new Stream();
  inputStream.delegate = Util.coerceInputStream(input);
  inputStream.pos = 0;
  inputStream.readByte = function() {
    this.pos++;
    return this.delegate.readByte();
  };
  inputStream.tell = function() { return this.pos; };
  if (inputStream.delegate.eof) {
    inputStream.eof = inputStream.delegate.eof.bind(inputStream.delegate);
  }
  var outputStream = new Stream();
  outputStream.pos = 0;
  outputStream.writeByte = function() { this.pos++; };

  var bz = new Bunzip(inputStream, outputStream);
  var blockSize = bz.dbufSize;
  while (true) {
    if ('eof' in inputStream && inputStream.eof()) break;

    var position = bz.reader.tellBit();

    if (bz._init_block()) {
      var start = outputStream.pos;
      bz._read_bunzip();
      callback(position, outputStream.pos - start);
    } else {
      var crc = bz.reader.readBits(32); // (but we ignore the crc)
      if (multistream &&
          'eof' in inputStream &&
          !inputStream.eof()) {
        // note that start_bunzip will also resync the bit reader to next byte
        bz._start_bunzip(inputStream, outputStream);
        console.assert(bz.dbufSize === blockSize,
                       "shouldn't change block size within multistream file");
      } else break;
    }
  }
};

// create a Huffman tree from the table of frequencies
var StaticHuffman = function(freq, alphabetSize) {
  // As in BZip2HuffmanStageEncoder.java (from jbzip2):
  // The Huffman allocator needs its input symbol frequencies to be
  // sorted, but we need to return code lengths in the same order as
  // the corresponding frequencies are passed in.
  // The symbol frequency and index are merged into a single array of
  // integers - frequency in the high 23 bits, index in the low 9
  // bits.
  //     2^23 = 8,388,608 which is higher than the maximum possible
  //            frequency for one symbol in a block
  //     2^9 = 512 which is higher than the maximum possible
  //            alphabet size (== 258)
  // Sorting this array simultaneously sorts the frequencies and
  // leaves a lookup that can be used to cheaply invert the sort
  var i, mergedFreq = [];
  for (i=0; i<alphabetSize; i++) {
    mergedFreq[i] = (freq[i] << 9) | i;
  }
  mergedFreq.sort(function(a,b) { return a-b; });
  var sortedFreq = mergedFreq.map(function(v) { return v>>>9; });
  // allocate code lengths in place. (result in sortedFreq array)
  HuffmanAllocator.allocateHuffmanCodeLengths(sortedFreq, MAX_HUFCODE_BITS);
  // reverse the sort to put codes & code lengths in order of input symbols
  this.codeLengths = Util.makeU8Buffer(alphabetSize);
  for (i=0; i<alphabetSize; i++) {
    var sym = mergedFreq[i] & 0x1FF;
    this.codeLengths[sym] = sortedFreq[i];
  }
};
// compute canonical Huffman codes, given code lengths
StaticHuffman.prototype.computeCanonical = function() {
  var alphabetSize = this.codeLengths.length;
  // merge arrays; sort first by length then by symbol.
  var i, merged = [];
  for (i=0; i<alphabetSize; i++) {
    merged[i] = (this.codeLengths[i] << 9) | i;
  }
  merged.sort(function(a,b) { return a-b; });
  // use sorted lengths to assign codes
  this.code = Util.makeU32Buffer(alphabetSize);
  var code = 0, prevLen = 0;
  for (i=0; i<alphabetSize; i++) {
    var curLen = merged[i] >>> 9;
    var sym = merged[i] & 0x1FF;
    console.assert(prevLen <= curLen);
    code <<= (curLen - prevLen);
    this.code[sym] = code++;
    prevLen = curLen;
  }
};
// compute the cost of encoding the given range of symbols w/ this Huffman code
StaticHuffman.prototype.cost = function(array, offset, length) {
  var i, cost = 0;
  for (i=0; i<length; i++) {
    cost += this.codeLengths[array[offset+i]];
  }
  return cost;
};
// emit the bit lengths used by this Huffman code
StaticHuffman.prototype.emit = function(outStream) {
  // write the starting length
  var i, currentLength = this.codeLengths[0];
  outStream.writeBits(5, currentLength);
  for (i=0; i<this.codeLengths.length; i++) {
    var codeLength = this.codeLengths[i];
    var value, delta;
    console.assert(codeLength > 0 && codeLength <= MAX_HUFCODE_BITS);
    if (currentLength < codeLength) {
      value = 2; delta = codeLength - currentLength;
    } else {
      value = 3; delta = currentLength - codeLength;
    }
    while (delta-- > 0) {
      outStream.writeBits(2, value);
    }
    outStream.writeBit(0);
    currentLength = codeLength;
  }
};
// encode the given symbol with this Huffman code
StaticHuffman.prototype.encode = function(outStream, symbol) {
  outStream.writeBits(this.codeLengths[symbol], this.code[symbol]);
};

// read a block for bzip2 compression.
var readBlock = function(inStream, block, length, crc) {
  var pos = 0;
  var lastChar = -1;
  var runLength = 0;
  while (pos < length) {
    if (runLength===4) {
      block[pos++] = 0;
      if (pos >= length) { break; }
    }
    var ch = inStream.readByte();
    if (ch === EOF) {
      break;
    }
    crc.updateCRC(ch);
    if (ch !== lastChar) {
      lastChar = ch;
      runLength = 1;
    } else {
      runLength++;
      if (runLength > 4) {
        if (runLength < 256) {
          block[pos-1]++;
          continue;
        } else {
          runLength = 1;
        }
      }
    }
    block[pos++] = ch;
  }
  return pos;
};

// divide the input into groups at most GROUP_SIZE symbols long.
// assign each group to the Huffman table which compresses it best.
var assignSelectors = function(selectors, groups, input) {
  var i, j, k;
  for (i=0, k=0; i<input.length; i+=GROUP_SIZE) {
    var groupSize = Math.min(GROUP_SIZE, input.length - i);
    var best = 0, bestCost = groups[0].cost(input, i, groupSize);
    for (j=1; j<groups.length; j++) {
      var groupCost = groups[j].cost(input, i, groupSize);
      if (groupCost < bestCost) {
        best = j; bestCost = groupCost;
      }
    }
    selectors[k++] = best;
  }
};
var optimizeHuffmanGroups = function(groups, targetGroups, input,
                                     selectors, alphabetSize) {
  // until we've got "targetGroups" Huffman codes, pick the Huffman code which
  // matches the largest # of groups and split it by picking the groups
  // which require more than the median number of bits to encode.
  // then recompute frequencies and reassign Huffman codes.
  var i, j, k, groupCounts = [];
  while (groups.length < targetGroups) {
    assignSelectors(selectors, groups, input);
    // which code gets used the most?
    for (i=0; i<groups.length; i++) { groupCounts[i] = 0; }
    for (i=0; i<selectors.length; i++) {
      groupCounts[selectors[i]]++;
    }
    var which = groupCounts.indexOf(Math.max.apply(Math, groupCounts));
    // ok, let's look at the size of those blocks
    var splits = [];
    for (i=0, j=0; i<selectors.length; i++) {
      if (selectors[i] !== which) { continue; }
      var start = i*GROUP_SIZE;
      var end = Math.min(start + GROUP_SIZE, input.length);
      splits.push({index: i, cost:groups[which].cost(input, start, end-start)});
    }
    // find the median.  there are O(n) algorithms to do this, but we'll
    // be lazy and use a full O(n ln n) sort.
    splits.sort(function(s1, s2) { return s1.cost - s2.cost; });
    // assign the groups in the top half to the "new" selector
    for (i=(splits.length>>>1); i<splits.length; i++) {
      selectors[splits[i].index] = groups.length;
    }
    groups.push(null);
    // recompute frequencies
    var freq = [], f;
    for (i=0; i<groups.length; i++) {
      f = freq[i] = [];
      for (j=0; j<alphabetSize; j++) { f[j] = 0; }
    }
    for (i=0, j=0; i<input.length; ) {
      f = freq[selectors[j++]];
      for (k=0; k<GROUP_SIZE && i<input.length; k++) {
        f[input[i++]]++;
      }
    }
    // reconstruct Huffman codes
    for (i=0; i<groups.length; i++) {
      groups[i] = new StaticHuffman(freq[i], alphabetSize);
    }
  }
};

var compressBlock = function(block, length, outStream) {
  var c, i, j, k;
  // do BWT transform
  var U = Util.makeU8Buffer(length);
  var pidx = BWT.bwtransform2(block, U, length, 256);
  outStream.writeBit(0); // not randomized
  outStream.writeBits(24, pidx);
  // track values used; write bitmap
  var used = [], compact = [];
  for (i=0; i<length; i++) {
    c = block[i];
    used[c] = true;
    compact[c>>>4] = true;
  }
  for (i=0; i<16; i++) {
    outStream.writeBit(!!compact[i]);
  }
  for (i=0; i<16; i++) {
    if (compact[i]) {
      for (j=0; j<16; j++) {
        outStream.writeBit(!!used[(i<<4)|j]);
      }
    }
  }
  var alphabetSize = 0;
  for (i=0; i<256; i++) {
    if (used[i]) {
      alphabetSize++;
    }
  }
  // now MTF and RLE/2 encoding, while tracking symbol statistics.
  // output can be one longer than length, because we include the
  // end-of-block character at the end. Similarly, we need a U16
  // array because the end-of-block character can be 256.
  var A = Util.makeU16Buffer(length+1);
  var endOfBlock = alphabetSize + 1;
  var freq = [];
  for (i=0; i<=endOfBlock; i++) { freq[i] = 0; }
  var M = Util.makeU8Buffer(alphabetSize);
  for (i=0, j=0; i<256; i++) {
    if (used[i]) { M[j++] = i; }
  }
  used = null; compact = null;
  var pos = 0, runLength = 0;
  var emit = function(c) {
    A[pos++] = c;
    freq[c]++;
  };
  var emitLastRun = function() {
    while (runLength !== 0) {
      if (runLength & 1) {
        emit(0); // RUNA
        runLength -= 1;
      } else {
        emit(1); // RUNB
        runLength -= 2;
      }
      runLength >>>= 1;
    }
  };
  for (i=0; i<U.length; i++) {
    c = U[i];
    // look for C in M
    for (j=0; j<alphabetSize; j++) {
      if (M[j]===c) { break; }
    }
    console.assert(j!==alphabetSize);
    // shift MTF array
    mtf(M, j);
    // emit j
    if (j===0) {
      runLength++;
    } else {
      emitLastRun();
      emit(j+1);
      runLength = 0;
    }
  }
  emitLastRun();
  emit(endOfBlock); // end of block symbol
  A = A.subarray(0, pos);
  // now A[0...pos) has the encoded output, and freq[0-alphabetSize] has the
  // frequencies.  Use these to construct Huffman tables.
  // the canonical bzip2 encoder does some complicated optimization
  // to attempt to select the best tables.  We're going to simplify things:
  // (unless the block is very short) we're always going to create MAX_GROUPS
  // tables; 1 based on global frequencies, and the rest based on dividing the
  // block into MAX_GROUPS-1 pieces.
  var groups = [];
  var targetGroups; // how many Huffman groups should we create?
  // look at length of MTF-encoded block to pick a good number of groups
  if (pos >= 2400) { targetGroups = 6; }
  else if (pos >= 1200) { targetGroups = 5; }
  else if (pos >= 600) { targetGroups = 4; }
  else if (pos >= 200) { targetGroups = 3; }
  else { targetGroups = 2; }
  // start with two Huffman groups: one with the global frequencies, and
  // a second with a flat frequency distribution (which is also the smallest
  // possible Huffman table to encode, which is handy to prevent excessive
  // bloat if the input file size is very small)
  groups.push(new StaticHuffman(freq, endOfBlock+1));
  for (i=0; i<=endOfBlock; i++) { freq[i] = 1; }
  groups.push(new StaticHuffman(freq, endOfBlock+1));
  freq = null;
  // Now optimize the Huffman groups!  this is a black art.
  // we probably don't want to waste too much time on it, though.
  var selectors = Util.makeU8Buffer(Math.ceil(pos / GROUP_SIZE));
  optimizeHuffmanGroups(groups, targetGroups, A, selectors, endOfBlock+1);
  assignSelectors(selectors, groups, A);

  // okay, let's start writing out our Huffman tables
  console.assert(groups.length >= MIN_GROUPS && groups.length <= MAX_GROUPS);
  outStream.writeBits(3, groups.length);
  // and write out the best selector for each group
  outStream.writeBits(15, selectors.length);
  for (i=0; i<groups.length; i++) { M[i] = i; } // initialize MTF table.
  for (i=0; i<selectors.length; i++) {
    var s = selectors[i];
    // find selector in MTF list
    for (j=0; j<groups.length; j++) { if (M[j]===s) { break; } }
    console.assert(j<groups.length);
    mtf(M, j);
    // emit 'j' as a unary number
    for (;j>0; j--) {
      outStream.writeBit(1);
    }
    outStream.writeBit(0);
  }
  // okay, now emit the Huffman tables in order.
  for (i=0; i<groups.length; i++) {
    groups[i].emit(outStream);
    groups[i].computeCanonical(); // get ready for next step while we're at it
  }
  // okay, now (finally!) emit the actual data!
  for (i=0, k=0; i<pos; ) {
    var huff = groups[selectors[k++]];
    for (j=0; j<GROUP_SIZE && i<pos; j++) {
      huff.encode(outStream, A[i++]);
    }
  }
  // done.
};

var Bzip2 = Object.create(null);
Bzip2.compressFile = function(inStream, outStream, props) {
  inStream = Util.coerceInputStream(inStream);
  var o = Util.coerceOutputStream(outStream, outStream);
  outStream = new BitStream(o.stream);

  var blockSizeMultiplier = 9;
  if (typeof(props)==='number') {
    blockSizeMultiplier = props;
  }
  if (blockSizeMultiplier < 1 || blockSizeMultiplier > 9) {
    throw new Error('Invalid block size multiplier');
  }

  var blockSize = blockSizeMultiplier * 100000;
  // the C implementation always writes at least length-19 characters,
  // but it reads ahead enough that if the last character written was part
  // of a run, it writes out the full run.
  // That's really annoying to implement.
  // So instead just subtract 19 from the blockSize; in most cases (unless
  // there's a run at the end of the block) this will yield block divisions
  // matching the C implementation.
  blockSize -= 19;

  // write file magic
  outStream.writeByte('B'.charCodeAt(0));
  outStream.writeByte('Z'.charCodeAt(0));
  outStream.writeByte('h'.charCodeAt(0)); // Huffman-coded bzip
  outStream.writeByte('0'.charCodeAt(0) + blockSizeMultiplier);

  // allocate a buffer for the block
  var block = Util.makeU8Buffer(blockSize);
  var streamCRC = 0;
  var length;

  do {
    var crc = new CRC32();
    length = readBlock(inStream, block, blockSize, crc);
    if (length > 0) {
      streamCRC = (((streamCRC << 1) | (streamCRC>>>31)) ^ crc.getCRC()) >>> 0;
      outStream.writeBits(48, WHOLEPI);
      outStream.writeBits(32, crc.getCRC());
      compressBlock(block, length, outStream);
    }
  } while (length === blockSize);

  // finish up
  outStream.writeBits(48, SQRTPI);
  outStream.writeBits(32, streamCRC);
  outStream.flush(); // get the last bits flushed out
  return o.retval;
};

Bzip2.decompressFile = Bunzip.decode;
Bzip2.decompressBlock = Bunzip.decodeBlock;
Bzip2.table = Bunzip.table;

// return Bzip2;
module.exports = Bzip2;
// });

},{"./BWT":13,"./BitStream":14,"./CRC32":16,"./HuffmanAllocator":17,"./Stream":18,"./Util":19,"./freeze":20}],16:[function(require,module,exports){
/* CRC32, used in Bzip2 implementation.
 * This is a port of CRC32.java from the jbzip2 implementation at
 *   https://code.google.com/p/jbzip2
 * which is:
 *   Copyright (c) 2011 Matthew Francis
 *
 *   Permission is hereby granted, free of charge, to any person
 *   obtaining a copy of this software and associated documentation
 *   files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use,
 *   copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following
 *   conditions:
 *
 *   The above copyright notice and this permission notice shall be
 *   included in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 *   OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 *   HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 *   WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 *   OTHER DEALINGS IN THE SOFTWARE.
 * This JavaScript implementation is:
 *   Copyright (c) 2013 C. Scott Ananian
 * with the same licensing terms as Matthew Francis' original implementation.
 */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./Util'], function(Util) {
const Util = require('./Util');

  /**
   * A static CRC lookup table
   */
    var crc32Lookup = Util.arraycopy(Util.makeU32Buffer(256), [
    0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9, 0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005,
    0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61, 0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
    0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9, 0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75,
    0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011, 0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
    0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039, 0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5,
    0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81, 0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
    0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49, 0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95,
    0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1, 0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
    0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae, 0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072,
    0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16, 0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
    0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde, 0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02,
    0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066, 0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
    0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e, 0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692,
    0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6, 0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
    0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e, 0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2,
    0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686, 0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
    0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637, 0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb,
    0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f, 0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
    0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47, 0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b,
    0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff, 0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
    0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7, 0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b,
    0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f, 0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
    0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7, 0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b,
    0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f, 0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
    0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640, 0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c,
    0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8, 0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
    0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30, 0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec,
    0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088, 0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
    0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0, 0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c,
    0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18, 0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
    0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0, 0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c,
    0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668, 0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4
  ]);

  var CRC32 = function() {
    /**
     * The current CRC
     */
    var crc = 0xffffffff;

    /**
     * @return The current CRC
     */
    this.getCRC = function() {
      return (~crc) >>> 0; // return an unsigned value
    };

    /**
     * Update the CRC with a single byte
     * @param value The value to update the CRC with
     */
    this.updateCRC = function(value) {
      crc = (crc << 8) ^ crc32Lookup[((crc >>> 24) ^ value) & 0xff];
    };

    /**
     * Update the CRC with a sequence of identical bytes
     * @param value The value to update the CRC with
     * @param count The number of bytes
     */
    this.updateCRCRun = function(value, count) {
      while (count-- > 0) {
        crc = (crc << 8) ^ crc32Lookup[((crc >>> 24) ^ value) & 0xff];
      }
    };
  };
  // return CRC32;
  module.exports = CRC32;
// });

},{"./Util":19}],17:[function(require,module,exports){
/**
 * An in-place, length restricted Canonical Huffman code length allocator
 *
 * Based on the algorithm proposed by R. L. Milidiú, A. A. Pessoa and
 * E. S. Laber in "In-place Length-Restricted Prefix Coding" (see:
 * http://www-di.inf.puc-rio.br/~laber/public/spire98.ps) and
 * incorporating additional ideas from the implementation of "shcodec"
 * by Simakov Alexander (see: http://webcenter.ru/~xander/)
 *
 * This JavaScript implementation ported from HuffmanAllocator.java from
 *   https://code.google.com/p/jbzip2
 * which is:
 *
 *   Copyright (c) 2011 Matthew Francis
 *
 *   Permission is hereby granted, free of charge, to any person
 *   obtaining a copy of this software and associated documentation
 *   files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use,
 *   copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following
 *   conditions:
 *
 *   The above copyright notice and this permission notice shall be
 *   included in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 *   OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 *   HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 *   WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 *   OTHER DEALINGS IN THE SOFTWARE.
 *
 * This JavaScript implementation is:
 *   Copyright (c) 2013 C. Scott Ananian
 * with the same licensing terms as Matthew Francis' original implementation.
 */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./freeze','./Util'], function(freeze, Util) {

const freeze = require('./freeze');
const Util = require('./Util');

  /**
   * FIRST() function
   * @param array The code length array
   * @param i The input position
   * @param nodesToMove The number of internal nodes to be relocated
   * @return The smallest {@code k} such that {@code nodesToMove <= k <= i} and
   *         {@code i <= (array[k] % array.length)}
   */
  var first = function(array, i, nodesToMove) {
    var length = array.length;
    var limit = i;
    var k = array.length - 2;

    while ((i >= nodesToMove) && ((array[i] % length) > limit)) {
      k = i;
      i -= (limit - i + 1);
    }
    i = Math.max (nodesToMove - 1, i);

    while (k > (i + 1)) {
      var temp = (i + k) >> 1;
      if ((array[temp] % length) > limit) {
        k = temp;
      } else {
        i = temp;
      }
    }

    return k;
  };

  /**
   * Fills the code array with extended parent pointers
   * @param array The code length array
   */
  var setExtendedParentPointers = function(array) {
    var length = array.length;

    array[0] += array[1];

    var headNode, tailNode, topNode, temp;
    for (headNode = 0, tailNode = 1, topNode = 2;
         tailNode < (length - 1);
         tailNode++) {
      if ((topNode >= length) || (array[headNode] < array[topNode])) {
        temp = array[headNode];
        array[headNode++] = tailNode;
      } else {
        temp = array[topNode++];
      }

      if ((topNode >= length) ||
          ((headNode < tailNode) && (array[headNode] < array[topNode]))) {
        temp += array[headNode];
        array[headNode++] = tailNode + length;
      } else {
        temp += array[topNode++];
      }

      array[tailNode] = temp;
    }
  };

  /**
   * Finds the number of nodes to relocate in order to achieve a given code
   * length limit
   * @param array The code length array
   * @param maximumLength The maximum bit length for the generated codes
   * @return The number of nodes to relocate
   */
  var findNodesToRelocate = function(array, maximumLength) {
    var currentNode = array.length - 2;
    var currentDepth;
    for (currentDepth = 1;
         (currentDepth < (maximumLength - 1)) && (currentNode > 1);
         currentDepth++) {
      currentNode =  first (array, currentNode - 1, 0);
    }

    return currentNode;
  };


  /**
   * A final allocation pass with no code length limit
   * @param array The code length array
   */
  var allocateNodeLengths = function(array) {
    var firstNode = array.length - 2;
    var nextNode = array.length - 1;
    var currentDepth, availableNodes, lastNode, i;

    for (currentDepth = 1, availableNodes = 2;
         availableNodes > 0;
         currentDepth++) {
      lastNode = firstNode;
      firstNode = first (array, lastNode - 1, 0);

      for (i = availableNodes - (lastNode - firstNode); i > 0; i--) {
        array[nextNode--] = currentDepth;
      }

      availableNodes = (lastNode - firstNode) << 1;
    }
  };

  /**
   * A final allocation pass that relocates nodes in order to achieve a
   * maximum code length limit
   * @param array The code length array
   * @param nodesToMove The number of internal nodes to be relocated
   * @param insertDepth The depth at which to insert relocated nodes
   */
  var allocateNodeLengthsWithRelocation = function(array, nodesToMove,
                                                   insertDepth) {
    var firstNode = array.length - 2;
    var nextNode = array.length - 1;
    var currentDepth = (insertDepth == 1) ? 2 : 1;
    var nodesLeftToMove = (insertDepth == 1) ? nodesToMove - 2 : nodesToMove;
    var availableNodes, lastNode, offset, i;

    for (availableNodes = currentDepth << 1;
         availableNodes > 0;
         currentDepth++) {
      lastNode = firstNode;
      firstNode = (firstNode <= nodesToMove) ? firstNode : first (array, lastNode - 1, nodesToMove);

      offset = 0;
      if (currentDepth >= insertDepth) {
        offset = Math.min (nodesLeftToMove, 1 << (currentDepth - insertDepth));
      } else if (currentDepth == (insertDepth - 1)) {
        offset = 1;
        if ((array[firstNode]) == lastNode) {
          firstNode++;
        }
      }

      for (i = availableNodes - (lastNode - firstNode + offset); i > 0; i--) {
        array[nextNode--] = currentDepth;
      }

      nodesLeftToMove -= offset;
      availableNodes = (lastNode - firstNode + offset) << 1;
    }
  };

  /**
   * Allocates Canonical Huffman code lengths in place based on a sorted
   * frequency array
   * @param array On input, a sorted array of symbol frequencies; On output,
   *              an array of Canonical Huffman code lengths
   * @param maximumLength The maximum code length. Must be at least
   *                      {@code ceil(log2(array.length))}
   */
  // public
  var allocateHuffmanCodeLengths = function(array, maximumLength) {
    switch (array.length) {
    case 2:
      array[1] = 1;
    case 1:
      array[0] = 1;
      return;
    }

    /* Pass 1 : Set extended parent pointers */
    setExtendedParentPointers (array);

    /* Pass 2 : Find number of nodes to relocate in order to achieve
     *          maximum code length */
    var nodesToRelocate = findNodesToRelocate (array, maximumLength);

    /* Pass 3 : Generate code lengths */
    if ((array[0] % array.length) >= nodesToRelocate) {
      allocateNodeLengths (array);
    } else {
      var insertDepth = maximumLength - (Util.fls(nodesToRelocate - 1));
      allocateNodeLengthsWithRelocation (array, nodesToRelocate, insertDepth);
    }
  };

  module.exports = freeze({
    allocateHuffmanCodeLengths: allocateHuffmanCodeLengths
  });
// });

},{"./Util":19,"./freeze":20}],18:[function(require,module,exports){
/** Abstract Stream interface, for byte-oriented i/o. */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./freeze'],function(freeze) {
const freeze = require('./freeze');
    var EOF = -1;

    var Stream = function() {
        /* ABSTRACT */
    };
    // you must define one of read / readByte for a readable stream
    Stream.prototype.readByte = function() {
        var buf = [ 0 ];
        var len = this.read(buf, 0, 1);
        if (len===0) { this._eof = true; return EOF; }
        return buf[0];
    };
    Stream.prototype.read = function(buf, bufOffset, length) {
        var ch, bytesRead = 0;
        while (bytesRead < length) {
            ch = this.readByte();
            if (ch === EOF) { this._eof = true; break; }
            buf[bufOffset+(bytesRead++)] = ch;
        }
        return bytesRead;
    };
    // reasonable default implementation of 'eof'
    Stream.prototype.eof = function() { return !!this._eof; };
    // not all readable streams are seekable
    Stream.prototype.seek = function(pos) {
        throw new Error('Stream is not seekable.');
    };
    Stream.prototype.tell = function() {
        throw new Error('Stream is not seekable.');
    };
    // you must define one of write / writeByte for a writable stream
    Stream.prototype.writeByte = function(_byte) {
        var buf = [ _byte ];
        this.write(buf, 0, 1);
    };
    Stream.prototype.write = function(buf, bufOffset, length) {
        var i;
        for (i=0; i<length; i++) {
            this.writeByte(buf[bufOffset + i]);
        }
        return length;
    };
    // flush will happily do nothing if you don't override it.
    Stream.prototype.flush = function() { };

    // export EOF as a constant.
    Stream.EOF = EOF;

    module.exports = freeze(Stream);
// });

},{"./freeze":20}],19:[function(require,module,exports){
(function (process,Buffer){(function (){
/* Some basic utilities, used in a number of places. */
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./freeze','./Stream'],function(freeze, Stream) {
const freeze = require('./freeze');
const Stream = require('./Stream');

    var Util = Object.create(null);

    var EOF = Stream.EOF;

    /* Take a buffer, array, or stream, and return an input stream. */
    Util.coerceInputStream = function(input, forceRead) {
        if (!('readByte' in input)) {
            var buffer = input;
            input = new Stream();
            input.size = buffer.length;
            input.pos = 0;
            input.readByte = function() {
                if (this.pos >= this.size) { return EOF; }
                return buffer[this.pos++];
            };
            input.read = function(buf, bufOffset, length) {
                var bytesRead = 0;
                while (bytesRead < length && this.pos < buffer.length) {
                    buf[bufOffset++] = buffer[this.pos++];
                    bytesRead++;
                }
                return bytesRead;
            };
            input.seek = function(pos) { this.pos = pos; };
            input.tell = function() { return this.pos; };
            input.eof = function() { return this.pos >= buffer.length; };
        } else if (forceRead && !('read' in input)) {
            // wrap input if it doesn't implement read
            var s = input;
            input = new Stream();
            input.readByte = function() {
                var ch = s.readByte();
                if (ch === EOF) { this._eof = true; }
                return ch;
            };
            if ('size' in s) { input.size = s.size; }
            if ('seek' in s) {
                input.seek = function(pos) {
                    s.seek(pos); // may throw if s doesn't implement seek
                    this._eof = false;
                };
            }
            if ('tell' in s) {
                input.tell = s.tell.bind(s);
            }
        }
        return input;
    };

    var BufferStream = function(buffer, resizeOk) {
        this.buffer = buffer;
        this.resizeOk = resizeOk;
        this.pos = 0;
    };
    BufferStream.prototype = Object.create(Stream.prototype);
    BufferStream.prototype.writeByte = function(_byte) {
        if (this.resizeOk && this.pos >= this.buffer.length) {
            var newBuffer = Util.makeU8Buffer(this.buffer.length * 2);
            newBuffer.set(this.buffer);
            this.buffer = newBuffer;
        }
        this.buffer[this.pos++] = _byte;
    };
    BufferStream.prototype.getBuffer = function() {
        // trim buffer if needed
        if (this.pos !== this.buffer.length) {
            if (!this.resizeOk)
                throw new TypeError('outputsize does not match decoded input');
            var newBuffer = Util.makeU8Buffer(this.pos);
            newBuffer.set(this.buffer.subarray(0, this.pos));
            this.buffer = newBuffer;
        }
        return this.buffer;
    };

    /* Take a stream (or not) and an (optional) size, and return an
     * output stream.  Return an object with a 'retval' field equal to
     * the output stream (if that was given) or else a pointer at the
     * internal Uint8Array/buffer/array; and a 'stream' field equal to
     * an output stream to use.
     */
    Util.coerceOutputStream = function(output, size) {
        var r = { stream: output, retval: output };
        if (output) {
            if (typeof(output)==='object' && 'writeByte' in output) {
                return r; /* leave output alone */
            } else if (typeof(size) === 'number') {
                console.assert(size >= 0);
                r.stream = new BufferStream(Util.makeU8Buffer(size), false);
            } else { // output is a buffer
                r.stream = new BufferStream(output, false);
            }
        } else {
            r.stream = new BufferStream(Util.makeU8Buffer(16384), true);
        }
        Object.defineProperty(r, 'retval', {
            get: r.stream.getBuffer.bind(r.stream)
        });
        return r;
    };

    Util.compressFileHelper = function(magic, guts, suppressFinalByte) {
        return function(inStream, outStream, props) {
            inStream = Util.coerceInputStream(inStream);
            var o = Util.coerceOutputStream(outStream, outStream);
            outStream = o.stream;

            // write the magic number to identify this file type
            // (it better be ASCII, we're not doing utf-8 conversion)
            var i;
            for (i=0; i<magic.length; i++) {
                outStream.writeByte(magic.charCodeAt(i));
            }

            // if we know the size, write it
            var fileSize;
            if ('size' in inStream && inStream.size >= 0) {
                fileSize = inStream.size;
            } else {
                fileSize = -1; // size unknown
            }
            if (suppressFinalByte) {
                var tmpOutput = Util.coerceOutputStream([]);
                Util.writeUnsignedNumber(tmpOutput.stream, fileSize + 1);
                tmpOutput = tmpOutput.retval;
                for (i=0; i<tmpOutput.length-1; i++) {
                    outStream.writeByte(tmpOutput[i]);
                }
                suppressFinalByte = tmpOutput[tmpOutput.length-1];
            } else {
                Util.writeUnsignedNumber(outStream, fileSize + 1);
            }

            // call the guts to do the real compression
            guts(inStream, outStream, fileSize, props, suppressFinalByte);

            return o.retval;
        };
    };
    Util.decompressFileHelper = function(magic, guts) {
        return function(inStream, outStream) {
            inStream = Util.coerceInputStream(inStream);

            // read the magic number to confirm this file type
            // (it better be ASCII, we're not doing utf-8 conversion)
            var i;
            for (i=0; i<magic.length; i++) {
                if (magic.charCodeAt(i) !== inStream.readByte()) {
                    throw new Error("Bad magic");
                }
            }

            // read the file size & create an appropriate output stream/buffer
            var fileSize = Util.readUnsignedNumber(inStream) - 1;
            var o = Util.coerceOutputStream(outStream, fileSize);
            outStream = o.stream;

            // call the guts to do the real decompression
            guts(inStream, outStream, fileSize);

            return o.retval;
        };
    };
    // a helper for simple self-test of model encode
    Util.compressWithModel = function(inStream, fileSize, model) {
        var inSize = 0;
        while (inSize !== fileSize) {
            var ch = inStream.readByte();
            if (ch === EOF) {
                model.encode(256); // end of stream;
                break;
            }
            model.encode(ch);
            inSize++;
        }
    };
    // a helper for simple self-test of model decode
    Util.decompressWithModel = function(outStream, fileSize, model) {
        var outSize = 0;
        while (outSize !== fileSize) {
            var ch = model.decode();
            if (ch === 256) {
                break; // end of stream;
            }
            outStream.writeByte(ch);
            outSize++;
        }
    };

    /** Write a number using a self-delimiting big-endian encoding. */
    Util.writeUnsignedNumber = function(output, n) {
        console.assert(n >= 0);
        var bytes = [], i;
        do {
            bytes.push(n & 0x7F);
            // use division instead of shift to allow encoding numbers up to
            // 2^53
            n = Math.floor( n / 128 );
        } while (n !== 0);
        bytes[0] |= 0x80; // mark end of encoding.
        for (i=bytes.length-1; i>=0; i--) {
            output.writeByte(bytes[i]); // write in big-endian order
        }
        return output;
    };

    /** Read a number using a self-delimiting big-endian encoding. */
    Util.readUnsignedNumber = function(input) {
        var n = 0, c;
        while (true) {
            c = input.readByte();
            if (c&0x80) { n += (c&0x7F); break; }
            // using + and * instead of << allows decoding numbers up to 2^53
            n = (n + c) * 128;
        }
        return n;
    };

    // Compatibility thunks for Buffer/TypedArray constructors.

    var zerofill = function(a) {
        for (var i = 0, len = a.length; i < len; i++) {
            a[i] = 0;
        }
        return a;
    };

    var fallbackarray = function(size) {
        return zerofill(new Array(size));
    };

    // Node 0.11.6 - 0.11.10ish don't properly zero fill typed arrays.
    // See https://github.com/joyent/node/issues/6664
    // Try to detect and workaround the bug.
    var ensureZeroed = function id(a) { return a; };
    if ((typeof(process) !== 'undefined') &&
        Array.prototype.some.call(new Uint32Array(128), function(x) {
            return x !== 0;
        })) {
        //console.warn('Working around broken TypedArray');
        ensureZeroed = zerofill;
    }

    /** Portable 8-bit unsigned buffer. */
    Util.makeU8Buffer = (typeof(Uint8Array) !== 'undefined') ? function(size) {
        // Uint8Array ought to be  automatically zero-filled
        return ensureZeroed(new Uint8Array(size));
    } : (typeof(Buffer) !== 'undefined') ? function(size) {
        var b = new Buffer(size);
        b.fill(0);
        return b;
    } : fallbackarray;

    /** Portable 16-bit unsigned buffer. */
    Util.makeU16Buffer = (typeof(Uint16Array) !== 'undefined') ? function(size) {
        // Uint16Array ought to be  automatically zero-filled
        return ensureZeroed(new Uint16Array(size));
    } : fallbackarray;

    /** Portable 32-bit unsigned buffer. */
    Util.makeU32Buffer = (typeof(Uint32Array) !== 'undefined') ? function(size) {
        // Uint32Array ought to be  automatically zero-filled
        return ensureZeroed(new Uint32Array(size));
    } : fallbackarray;

    /** Portable 32-bit signed buffer. */
    Util.makeS32Buffer = (typeof(Int32Array) !== 'undefined') ? function(size) {
        // Int32Array ought to be  automatically zero-filled
        return ensureZeroed(new Int32Array(size));
    } : fallbackarray;

    Util.arraycopy = function(dst, src) {
        console.assert(dst.length >= src.length);
        for (var i = 0, len = src.length; i < len ; i++) {
            dst[i] = src[i];
        }
        return dst;
    };

    /** Highest bit set in a byte. */
    var bytemsb = [
        0, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
        7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
        8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8 /* 256 */
    ];
    console.assert(bytemsb.length===0x100);
    /** Find last set (most significant bit).
     *  @return the last bit set in the argument.
     *          <code>fls(0)==0</code> and <code>fls(1)==1</code>. */
    var fls = Util.fls = function(v) {
        console.assert(v>=0);
        if (v > 0xFFFFFFFF) { // use floating-point mojo
            return 32 + fls(Math.floor(v / 0x100000000));
        }
        if ( (v & 0xFFFF0000) !== 0) {
            if ( (v & 0xFF000000) !== 0) {
                return 24 + bytemsb[(v>>>24) & 0xFF];
            } else {
                return 16 + bytemsb[v>>>16];
            }
        } else if ( (v & 0x0000FF00) !== 0) {
            return 8 + bytemsb[v>>>8];
        } else {
            return bytemsb[v];
        }
    };
    /** Returns ceil(log2(n)) */
    Util.log2c = function(v) {
        return (v===0)?-1:fls(v-1);
    };

    module.exports = freeze(Util); // ensure constants are recognized as such.
// });

}).call(this)}).call(this,require('_process'),require("buffer").Buffer)
},{"./Stream":18,"./freeze":20,"_process":44,"buffer":24}],20:[function(require,module,exports){
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define([],function(){
  // 'use strict';

  // Object.freeze(), or a thunk if that method is not present in this
  // JavaScript environment.

  if (Object.freeze) {
    // return Object.freeze;
    module.exports = Object.freeze;
  } else {
    // return function(o) { return o; };
    module.exports = function(o) { return o; };
  }

// });

},{}],21:[function(require,module,exports){
// if (typeof define !== 'function') { var define = require('amdefine')(module); }
// define(['./lib/freeze','./lib/BitStream','./lib/Stream','./lib/BWT','./lib/Context1Model','./lib/DefSumModel','./lib/FenwickModel','./lib/MTFModel','./lib/NoModel','./lib/Huffman','./lib/RangeCoder','./lib/BWTC','./lib/Bzip2','./lib/Dmc','./lib/Lzjb','./lib/LzjbR','./lib/Lzp3','./lib/PPM','./lib/Simple'], function(freeze,BitStream,Stream,BWT,Context1Model,DefSumModel,FenwickModel,MTFModel,NoModel,Huffman,RangeCoder,BWTC,Bzip2,Dmc,Lzjb,LzjbR,Lzp3,PPM,Simple) {
//     'use strict';
//     return freeze({
//         version: "0.0.1",
//         // APIs
//         BitStream: BitStream,
//         Stream: Stream,
//         // transforms
//         BWT: BWT,
//         // models and coder
//         Context1Model: Context1Model,
//         DefSumModel: DefSumModel,
//         FenwickModel: FenwickModel,
//         MTFModel: MTFModel,
//         NoModel: NoModel,
//         Huffman: Huffman,
//         RangeCoder: RangeCoder,
//         // compression methods
//         BWTC: BWTC,
//         Bzip2: Bzip2,
//         Dmc: Dmc,
//         Lzjb: Lzjb,
//         LzjbR: LzjbR,
//         Lzp3: Lzp3,
//         PPM: PPM,
//         Simple: Simple
//     });
// });

var freeze = require('./lib/freeze');
var Bzip2 = require('./lib/Bzip2');

module.exports = freeze({
    version: "0.0.1",
    Bzip2: Bzip2
});
},{"./lib/Bzip2":15,"./lib/freeze":20}],22:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],23:[function(require,module,exports){

},{}],24:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":22,"buffer":24,"ieee754":27}],25:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 *  Copyright 2008 Fair Oaks Labs, Inc.
 *  All rights reserved.
 */

// Utility object:  Encode/Decode C-style binary primitives to/from octet arrays
function BufferPack() {
  // Module-level (private) variables
  var el,  bBE = false, m = this;

  // Raw byte arrays
  m._DeArray = function (a, p, l) {
    return [a.slice(p,p+l)];
  };
  m._EnArray = function (a, p, l, v) {
    for (var i = 0; i < l; a[p+i] = v[i]?v[i]:0, i++);
  };

  // ASCII characters
  m._DeChar = function (a, p) {
    return String.fromCharCode(a[p]);
  };
  m._EnChar = function (a, p, v) {
    a[p] = v.charCodeAt(0);
  };

  // Little-endian (un)signed N-byte integers
  m._DeInt = function (a, p) {
    var lsb = bBE?(el.len-1):0, nsb = bBE?-1:1, stop = lsb+nsb*el.len, rv, i, f;
    for (rv = 0, i = lsb, f = 1; i != stop; rv+=(a[p+i]*f), i+=nsb, f*=256);
    if (el.bSigned && (rv & Math.pow(2, el.len*8-1))) {
      rv -= Math.pow(2, el.len*8);
    }
    return rv;
  };
  m._EnInt = function (a, p, v) {
    var lsb = bBE?(el.len-1):0, nsb = bBE?-1:1, stop = lsb+nsb*el.len, i;
    v = (v<el.min)?el.min:(v>el.max)?el.max:v;
    for (i = lsb; i != stop; a[p+i]=v&0xff, i+=nsb, v>>=8);
  };

  // ASCII character strings
  m._DeString = function (a, p, l) {
    for (var rv = new Array(l), i = 0; i < l; rv[i] = String.fromCharCode(a[p+i]), i++);
    return rv.join('');
  };
  m._EnString = function (a, p, l, v) {
    for (var t, i = 0; i < l; a[p+i] = (t=v.charCodeAt(i))?t:0, i++);
  };

  // ASCII character strings null terminated
  m._DeNullString = function (a, p, l, v) {
    var str = m._DeString(a, p, l, v);
    return str.substring(0, str.length - 1);
  };

  // Little-endian N-bit IEEE 754 floating point
  m._De754 = function (a, p) {
    var s, e, m, i, d, nBits, mLen, eLen, eBias, eMax;
    mLen = el.mLen, eLen = el.len*8-el.mLen-1, eMax = (1<<eLen)-1, eBias = eMax>>1;

    i = bBE?0:(el.len-1); d = bBE?1:-1; s = a[p+i]; i+=d; nBits = -7;
    for (e = s&((1<<(-nBits))-1), s>>=(-nBits), nBits += eLen; nBits > 0; e=e*256+a[p+i], i+=d, nBits-=8);
    for (m = e&((1<<(-nBits))-1), e>>=(-nBits), nBits += mLen; nBits > 0; m=m*256+a[p+i], i+=d, nBits-=8);

    switch (e) {
    case 0:
      // Zero, or denormalized number
      e = 1-eBias;
      break;
    case eMax:
      // NaN, or +/-Infinity
      return m?NaN:((s?-1:1)*Infinity);
    default:
      // Normalized number
      m = m + Math.pow(2, mLen);
      e = e - eBias;
      break;
    }
    return (s?-1:1) * m * Math.pow(2, e-mLen);
  };
  m._En754 = function (a, p, v) {
    var s, e, m, i, d, c, mLen, eLen, eBias, eMax;
    mLen = el.mLen, eLen = el.len*8-el.mLen-1, eMax = (1<<eLen)-1, eBias = eMax>>1;

    s = v<0?1:0;
    v = Math.abs(v);
    if (isNaN(v) || (v == Infinity)) {
      m = isNaN(v)?1:0;
      e = eMax;
    } else {
      e = Math.floor(Math.log(v)/Math.LN2);			// Calculate log2 of the value

      if (v*(c = Math.pow(2, -e)) < 1) {
        e--; c*=2;						// Math.log() isn't 100% reliable
      }

      // Round by adding 1/2 the significand's LSD
      if (e+eBias >= 1) {
        v += el.rt/c;                                           // Normalized:  mLen significand digits
      } else {
        v += el.rt*Math.pow(2, 1-eBias);                        // Denormalized:  <= mLen significand digits
      }

      if (v*c >= 2) {
        e++; c/=2;						// Rounding can increment the exponent
      }

      if (e+eBias >= eMax) {
        // Overflow
        m = 0;
        e = eMax;
      } else if (e+eBias >= 1) {
        // Normalized - term order matters, as Math.pow(2, 52-e) and v*Math.pow(2, 52) can overflow
        m = (v*c-1)*Math.pow(2, mLen);
        e = e + eBias;
      } else {
        // Denormalized - also catches the '0' case, somewhat by chance
        m = v*Math.pow(2, eBias-1)*Math.pow(2, mLen);
        e = 0;
      }
    }

    for (i = bBE?(el.len-1):0, d=bBE?-1:1; mLen >= 8; a[p+i]=m&0xff, i+=d, m/=256, mLen-=8);
    for (e=(e<<mLen)|m, eLen+=mLen; eLen > 0; a[p+i]=e&0xff, i+=d, e/=256, eLen-=8);
    a[p+i-d] |= s*128;
  };

  // Class data
  m._sPattern = '(\\d+)?([AxcbBhHsSfdiIlL])(\\(([a-zA-Z0-9]+)\\))?';
  m._lenLut = {'A': 1, 'x': 1, 'c': 1, 'b': 1, 'B': 1, 'h': 2, 'H': 2, 's': 1,
               'S': 1, 'f': 4, 'd': 8, 'i': 4, 'I': 4, 'l': 4, 'L': 4};
  m._elLut = {'A': {en: m._EnArray, de: m._DeArray},
              's': {en: m._EnString, de: m._DeString},
              'S': {en: m._EnString, de: m._DeNullString},
              'c': {en: m._EnChar, de: m._DeChar},
              'b': {en: m._EnInt, de: m._DeInt, len: 1, bSigned: true, min: -Math.pow(2, 7), max: Math.pow(2, 7) - 1},
              'B': {en: m._EnInt, de: m._DeInt, len: 1, bSigned: false, min: 0, max: Math.pow(2, 8) - 1},
              'h': {en: m._EnInt, de: m._DeInt, len: 2, bSigned: true, min: -Math.pow(2, 15), max: Math.pow(2, 15) - 1},
              'H': {en: m._EnInt, de: m._DeInt, len: 2, bSigned: false, min: 0, max: Math.pow(2, 16) - 1},
              'i': {en: m._EnInt, de: m._DeInt, len: 4, bSigned: true, min: -Math.pow(2, 31), max: Math.pow(2, 31) - 1},
              'I': {en: m._EnInt, de: m._DeInt, len: 4, bSigned: false, min: 0, max: Math.pow(2, 32) - 1},
              'l': {en: m._EnInt, de: m._DeInt, len: 4, bSigned: true, min: -Math.pow(2, 31), max: Math.pow(2, 31) - 1},
              'L': {en: m._EnInt, de: m._DeInt, len: 4, bSigned: false, min: 0, max: Math.pow(2, 32) - 1},
              'f': {en: m._En754, de: m._De754, len: 4, mLen: 23, rt: Math.pow(2, -24) - Math.pow(2, -77)},
              'd': {en: m._En754, de: m._De754, len: 8, mLen: 52, rt: 0}};

  // Unpack a series of n elements of size s from array a at offset p with fxn
  m._UnpackSeries = function (n, s, a, p) {
    for (var fxn = el.de, rv = [], i = 0; i < n; rv.push(fxn(a, p+i*s)), i++);
    return rv;
  };

  // Pack a series of n elements of size s from array v at offset i to array a at offset p with fxn
  m._PackSeries = function (n, s, a, p, v, i) {
    for (var fxn = el.en, o = 0; o < n; fxn(a, p+o*s, v[i+o]), o++);
  };

  m._zip = function (keys, values) {
    var result = {};

    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = values[i];
    }

    return result;
  }

  // Unpack the octet array a, beginning at offset p, according to the fmt string
  m.unpack = function (fmt, a, p) {
    // Set the private bBE flag based on the format string - assume big-endianness
    bBE = (fmt.charAt(0) != '<');

    p = p?p:0;
    var re = new RegExp(this._sPattern, 'g');
    var m;
    var n;
    var s;
    var rk = [];
    var rv = [];
    
    while (m = re.exec(fmt)) {
      n = ((m[1]==undefined)||(m[1]==''))?1:parseInt(m[1]);

      if(m[2] === 'S') { // Null term string support
        n = 0; // Need to deal with empty  null term strings
        while(a[p + n] !== 0) {
          n++;
        }
        n++; // Add one for null byte
      }

      s = this._lenLut[m[2]];

      if ((p + n*s) > a.length) {
        return undefined;
      }

      switch (m[2]) {
      case 'A': case 's': case 'S':
        rv.push(this._elLut[m[2]].de(a, p, n));
        break;
      case 'c': case 'b': case 'B': case 'h': case 'H':
      case 'i': case 'I': case 'l': case 'L': case 'f': case 'd':
        el = this._elLut[m[2]];
        rv.push(this._UnpackSeries(n, s, a, p));
        break;
      }

      rk.push(m[4]); // Push key on to array

      p += n*s;
    }   

    rv = Array.prototype.concat.apply([], rv)

    if(rk.indexOf(undefined) !== -1) {
      return rv;
    } else {
      return this._zip(rk, rv);
    }
  };

  // Pack the supplied values into the octet array a, beginning at offset p, according to the fmt string
  m.packTo = function (fmt, a, p, values) {
    // Set the private bBE flag based on the format string - assume big-endianness
    bBE = (fmt.charAt(0) != '<');

    var re = new RegExp(this._sPattern, 'g');
    var m;
    var n;
    var s;
    var i = 0;
    var j;

    while (m = re.exec(fmt)) {
      n = ((m[1]==undefined)||(m[1]==''))?1:parseInt(m[1]);

      // Null term string support
      if(m[2] === 'S') {
        n = values[i].length + 1; // Add one for null byte
      }

      s = this._lenLut[m[2]];

      if ((p + n*s) > a.length) {
        return false;
      }

      switch (m[2]) {
      case 'A': case 's': case 'S':
        if ((i + 1) > values.length) { return false; }
        this._elLut[m[2]].en(a, p, n, values[i]);
        i += 1;
        break;
      case 'c': case 'b': case 'B': case 'h': case 'H':
      case 'i': case 'I': case 'l': case 'L': case 'f': case 'd':
        el = this._elLut[m[2]];
        if ((i + n) > values.length) { return false; }
        this._PackSeries(n, s, a, p, values, i);
        i += n;
        break;
      case 'x':
        for (j = 0; j < n; j++) { a[p+j] = 0; }
        break;
      }
      p += n*s;
    }

    return a;
  };

  // Pack the supplied values into a new octet array, according to the fmt string
  m.pack = function (fmt, values) {
    return this.packTo(fmt, new Buffer(this.calcLength(fmt, values)), 0, values);
  };

  // Determine the number of bytes represented by the format string
  m.calcLength = function (format, values) {
    var re = new RegExp(this._sPattern, 'g'), m, sum = 0, i = 0;
    while (m = re.exec(format)) {
      var n = (((m[1]==undefined)||(m[1]==''))?1:parseInt(m[1])) * this._lenLut[m[2]];

      if(m[2] === 'S') {
        n = values[i].length + 1; // Add one for null byte
      }

      sum += n;
      i++;
    }
    return sum;
  };
};

module.exports = new BufferPack();

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":24}],26:[function(require,module,exports){
/**
 * chroma.js - JavaScript library for color conversions
 *
 * Copyright (c) 2011-2019, Gregor Aisch
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. The name Gregor Aisch may not be used to endorse or promote products
 * derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL GREGOR AISCH OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * -------------------------------------------------------
 *
 * chroma.js includes colors from colorbrewer2.org, which are released under
 * the following license:
 *
 * Copyright (c) 2002 Cynthia Brewer, Mark Harrower,
 * and The Pennsylvania State University.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied. See the License for the specific
 * language governing permissions and limitations under the License.
 *
 * ------------------------------------------------------
 *
 * Named colors are taken from X11 Color Names.
 * http://www.w3.org/TR/css3-color/#svg-color
 *
 * @preserve
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.chroma = factory());
})(this, (function () { 'use strict';

    var limit$2 = function (x, min, max) {
        if ( min === void 0 ) min=0;
        if ( max === void 0 ) max=1;

        return x < min ? min : x > max ? max : x;
    };

    var limit$1 = limit$2;

    var clip_rgb$3 = function (rgb) {
        rgb._clipped = false;
        rgb._unclipped = rgb.slice(0);
        for (var i=0; i<=3; i++) {
            if (i < 3) {
                if (rgb[i] < 0 || rgb[i] > 255) { rgb._clipped = true; }
                rgb[i] = limit$1(rgb[i], 0, 255);
            } else if (i === 3) {
                rgb[i] = limit$1(rgb[i], 0, 1);
            }
        }
        return rgb;
    };

    // ported from jQuery's $.type
    var classToType = {};
    for (var i$1 = 0, list$1 = ['Boolean', 'Number', 'String', 'Function', 'Array', 'Date', 'RegExp', 'Undefined', 'Null']; i$1 < list$1.length; i$1 += 1) {
        var name = list$1[i$1];

        classToType[("[object " + name + "]")] = name.toLowerCase();
    }
    var type$p = function(obj) {
        return classToType[Object.prototype.toString.call(obj)] || "object";
    };

    var type$o = type$p;

    var unpack$B = function (args, keyOrder) {
        if ( keyOrder === void 0 ) keyOrder=null;

    	// if called with more than 3 arguments, we return the arguments
        if (args.length >= 3) { return Array.prototype.slice.call(args); }
        // with less than 3 args we check if first arg is object
        // and use the keyOrder string to extract and sort properties
    	if (type$o(args[0]) == 'object' && keyOrder) {
    		return keyOrder.split('')
    			.filter(function (k) { return args[0][k] !== undefined; })
    			.map(function (k) { return args[0][k]; });
    	}
    	// otherwise we just return the first argument
    	// (which we suppose is an array of args)
        return args[0];
    };

    var type$n = type$p;

    var last$4 = function (args) {
        if (args.length < 2) { return null; }
        var l = args.length-1;
        if (type$n(args[l]) == 'string') { return args[l].toLowerCase(); }
        return null;
    };

    var PI$2 = Math.PI;

    var utils = {
    	clip_rgb: clip_rgb$3,
    	limit: limit$2,
    	type: type$p,
    	unpack: unpack$B,
    	last: last$4,
    	PI: PI$2,
    	TWOPI: PI$2*2,
    	PITHIRD: PI$2/3,
    	DEG2RAD: PI$2 / 180,
    	RAD2DEG: 180 / PI$2
    };

    var input$h = {
    	format: {},
    	autodetect: []
    };

    var last$3 = utils.last;
    var clip_rgb$2 = utils.clip_rgb;
    var type$m = utils.type;
    var _input = input$h;

    var Color$D = function Color() {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var me = this;
        if (type$m(args[0]) === 'object' &&
            args[0].constructor &&
            args[0].constructor === this.constructor) {
            // the argument is already a Color instance
            return args[0];
        }

        // last argument could be the mode
        var mode = last$3(args);
        var autodetect = false;

        if (!mode) {
            autodetect = true;
            if (!_input.sorted) {
                _input.autodetect = _input.autodetect.sort(function (a,b) { return b.p - a.p; });
                _input.sorted = true;
            }
            // auto-detect format
            for (var i = 0, list = _input.autodetect; i < list.length; i += 1) {
                var chk = list[i];

                mode = chk.test.apply(chk, args);
                if (mode) { break; }
            }
        }

        if (_input.format[mode]) {
            var rgb = _input.format[mode].apply(null, autodetect ? args : args.slice(0,-1));
            me._rgb = clip_rgb$2(rgb);
        } else {
            throw new Error('unknown format: '+args);
        }

        // add alpha channel
        if (me._rgb.length === 3) { me._rgb.push(1); }
    };

    Color$D.prototype.toString = function toString () {
        if (type$m(this.hex) == 'function') { return this.hex(); }
        return ("[" + (this._rgb.join(',')) + "]");
    };

    var Color_1 = Color$D;

    var chroma$k = function () {
    	var args = [], len = arguments.length;
    	while ( len-- ) args[ len ] = arguments[ len ];

    	return new (Function.prototype.bind.apply( chroma$k.Color, [ null ].concat( args) ));
    };

    chroma$k.Color = Color_1;
    chroma$k.version = '2.4.2';

    var chroma_1 = chroma$k;

    var unpack$A = utils.unpack;
    var max$2 = Math.max;

    var rgb2cmyk$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$A(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        r = r / 255;
        g = g / 255;
        b = b / 255;
        var k = 1 - max$2(r,max$2(g,b));
        var f = k < 1 ? 1 / (1-k) : 0;
        var c = (1-r-k) * f;
        var m = (1-g-k) * f;
        var y = (1-b-k) * f;
        return [c,m,y,k];
    };

    var rgb2cmyk_1 = rgb2cmyk$1;

    var unpack$z = utils.unpack;

    var cmyk2rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$z(args, 'cmyk');
        var c = args[0];
        var m = args[1];
        var y = args[2];
        var k = args[3];
        var alpha = args.length > 4 ? args[4] : 1;
        if (k === 1) { return [0,0,0,alpha]; }
        return [
            c >= 1 ? 0 : 255 * (1-c) * (1-k), // r
            m >= 1 ? 0 : 255 * (1-m) * (1-k), // g
            y >= 1 ? 0 : 255 * (1-y) * (1-k), // b
            alpha
        ];
    };

    var cmyk2rgb_1 = cmyk2rgb;

    var chroma$j = chroma_1;
    var Color$C = Color_1;
    var input$g = input$h;
    var unpack$y = utils.unpack;
    var type$l = utils.type;

    var rgb2cmyk = rgb2cmyk_1;

    Color$C.prototype.cmyk = function() {
        return rgb2cmyk(this._rgb);
    };

    chroma$j.cmyk = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$C, [ null ].concat( args, ['cmyk']) ));
    };

    input$g.format.cmyk = cmyk2rgb_1;

    input$g.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$y(args, 'cmyk');
            if (type$l(args) === 'array' && args.length === 4) {
                return 'cmyk';
            }
        }
    });

    var unpack$x = utils.unpack;
    var last$2 = utils.last;
    var rnd = function (a) { return Math.round(a*100)/100; };

    /*
     * supported arguments:
     * - hsl2css(h,s,l)
     * - hsl2css(h,s,l,a)
     * - hsl2css([h,s,l], mode)
     * - hsl2css([h,s,l,a], mode)
     * - hsl2css({h,s,l,a}, mode)
     */
    var hsl2css$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var hsla = unpack$x(args, 'hsla');
        var mode = last$2(args) || 'lsa';
        hsla[0] = rnd(hsla[0] || 0);
        hsla[1] = rnd(hsla[1]*100) + '%';
        hsla[2] = rnd(hsla[2]*100) + '%';
        if (mode === 'hsla' || (hsla.length > 3 && hsla[3]<1)) {
            hsla[3] = hsla.length > 3 ? hsla[3] : 1;
            mode = 'hsla';
        } else {
            hsla.length = 3;
        }
        return (mode + "(" + (hsla.join(',')) + ")");
    };

    var hsl2css_1 = hsl2css$1;

    var unpack$w = utils.unpack;

    /*
     * supported arguments:
     * - rgb2hsl(r,g,b)
     * - rgb2hsl(r,g,b,a)
     * - rgb2hsl([r,g,b])
     * - rgb2hsl([r,g,b,a])
     * - rgb2hsl({r,g,b,a})
     */
    var rgb2hsl$3 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$w(args, 'rgba');
        var r = args[0];
        var g = args[1];
        var b = args[2];

        r /= 255;
        g /= 255;
        b /= 255;

        var min = Math.min(r, g, b);
        var max = Math.max(r, g, b);

        var l = (max + min) / 2;
        var s, h;

        if (max === min){
            s = 0;
            h = Number.NaN;
        } else {
            s = l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
        }

        if (r == max) { h = (g - b) / (max - min); }
        else if (g == max) { h = 2 + (b - r) / (max - min); }
        else if (b == max) { h = 4 + (r - g) / (max - min); }

        h *= 60;
        if (h < 0) { h += 360; }
        if (args.length>3 && args[3]!==undefined) { return [h,s,l,args[3]]; }
        return [h,s,l];
    };

    var rgb2hsl_1 = rgb2hsl$3;

    var unpack$v = utils.unpack;
    var last$1 = utils.last;
    var hsl2css = hsl2css_1;
    var rgb2hsl$2 = rgb2hsl_1;
    var round$6 = Math.round;

    /*
     * supported arguments:
     * - rgb2css(r,g,b)
     * - rgb2css(r,g,b,a)
     * - rgb2css([r,g,b], mode)
     * - rgb2css([r,g,b,a], mode)
     * - rgb2css({r,g,b,a}, mode)
     */
    var rgb2css$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var rgba = unpack$v(args, 'rgba');
        var mode = last$1(args) || 'rgb';
        if (mode.substr(0,3) == 'hsl') {
            return hsl2css(rgb2hsl$2(rgba), mode);
        }
        rgba[0] = round$6(rgba[0]);
        rgba[1] = round$6(rgba[1]);
        rgba[2] = round$6(rgba[2]);
        if (mode === 'rgba' || (rgba.length > 3 && rgba[3]<1)) {
            rgba[3] = rgba.length > 3 ? rgba[3] : 1;
            mode = 'rgba';
        }
        return (mode + "(" + (rgba.slice(0,mode==='rgb'?3:4).join(',')) + ")");
    };

    var rgb2css_1 = rgb2css$1;

    var unpack$u = utils.unpack;
    var round$5 = Math.round;

    var hsl2rgb$1 = function () {
        var assign;

        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];
        args = unpack$u(args, 'hsl');
        var h = args[0];
        var s = args[1];
        var l = args[2];
        var r,g,b;
        if (s === 0) {
            r = g = b = l*255;
        } else {
            var t3 = [0,0,0];
            var c = [0,0,0];
            var t2 = l < 0.5 ? l * (1+s) : l+s-l*s;
            var t1 = 2 * l - t2;
            var h_ = h / 360;
            t3[0] = h_ + 1/3;
            t3[1] = h_;
            t3[2] = h_ - 1/3;
            for (var i=0; i<3; i++) {
                if (t3[i] < 0) { t3[i] += 1; }
                if (t3[i] > 1) { t3[i] -= 1; }
                if (6 * t3[i] < 1)
                    { c[i] = t1 + (t2 - t1) * 6 * t3[i]; }
                else if (2 * t3[i] < 1)
                    { c[i] = t2; }
                else if (3 * t3[i] < 2)
                    { c[i] = t1 + (t2 - t1) * ((2 / 3) - t3[i]) * 6; }
                else
                    { c[i] = t1; }
            }
            (assign = [round$5(c[0]*255),round$5(c[1]*255),round$5(c[2]*255)], r = assign[0], g = assign[1], b = assign[2]);
        }
        if (args.length > 3) {
            // keep alpha channel
            return [r,g,b,args[3]];
        }
        return [r,g,b,1];
    };

    var hsl2rgb_1 = hsl2rgb$1;

    var hsl2rgb = hsl2rgb_1;
    var input$f = input$h;

    var RE_RGB = /^rgb\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;
    var RE_RGBA = /^rgba\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*([01]|[01]?\.\d+)\)$/;
    var RE_RGB_PCT = /^rgb\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/;
    var RE_RGBA_PCT = /^rgba\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/;
    var RE_HSL = /^hsl\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/;
    var RE_HSLA = /^hsla\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/;

    var round$4 = Math.round;

    var css2rgb$1 = function (css) {
        css = css.toLowerCase().trim();
        var m;

        if (input$f.format.named) {
            try {
                return input$f.format.named(css);
            } catch (e) {
                // eslint-disable-next-line
            }
        }

        // rgb(250,20,0)
        if ((m = css.match(RE_RGB))) {
            var rgb = m.slice(1,4);
            for (var i=0; i<3; i++) {
                rgb[i] = +rgb[i];
            }
            rgb[3] = 1;  // default alpha
            return rgb;
        }

        // rgba(250,20,0,0.4)
        if ((m = css.match(RE_RGBA))) {
            var rgb$1 = m.slice(1,5);
            for (var i$1=0; i$1<4; i$1++) {
                rgb$1[i$1] = +rgb$1[i$1];
            }
            return rgb$1;
        }

        // rgb(100%,0%,0%)
        if ((m = css.match(RE_RGB_PCT))) {
            var rgb$2 = m.slice(1,4);
            for (var i$2=0; i$2<3; i$2++) {
                rgb$2[i$2] = round$4(rgb$2[i$2] * 2.55);
            }
            rgb$2[3] = 1;  // default alpha
            return rgb$2;
        }

        // rgba(100%,0%,0%,0.4)
        if ((m = css.match(RE_RGBA_PCT))) {
            var rgb$3 = m.slice(1,5);
            for (var i$3=0; i$3<3; i$3++) {
                rgb$3[i$3] = round$4(rgb$3[i$3] * 2.55);
            }
            rgb$3[3] = +rgb$3[3];
            return rgb$3;
        }

        // hsl(0,100%,50%)
        if ((m = css.match(RE_HSL))) {
            var hsl = m.slice(1,4);
            hsl[1] *= 0.01;
            hsl[2] *= 0.01;
            var rgb$4 = hsl2rgb(hsl);
            rgb$4[3] = 1;
            return rgb$4;
        }

        // hsla(0,100%,50%,0.5)
        if ((m = css.match(RE_HSLA))) {
            var hsl$1 = m.slice(1,4);
            hsl$1[1] *= 0.01;
            hsl$1[2] *= 0.01;
            var rgb$5 = hsl2rgb(hsl$1);
            rgb$5[3] = +m[4];  // default alpha = 1
            return rgb$5;
        }
    };

    css2rgb$1.test = function (s) {
        return RE_RGB.test(s) ||
            RE_RGBA.test(s) ||
            RE_RGB_PCT.test(s) ||
            RE_RGBA_PCT.test(s) ||
            RE_HSL.test(s) ||
            RE_HSLA.test(s);
    };

    var css2rgb_1 = css2rgb$1;

    var chroma$i = chroma_1;
    var Color$B = Color_1;
    var input$e = input$h;
    var type$k = utils.type;

    var rgb2css = rgb2css_1;
    var css2rgb = css2rgb_1;

    Color$B.prototype.css = function(mode) {
        return rgb2css(this._rgb, mode);
    };

    chroma$i.css = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$B, [ null ].concat( args, ['css']) ));
    };

    input$e.format.css = css2rgb;

    input$e.autodetect.push({
        p: 5,
        test: function (h) {
            var rest = [], len = arguments.length - 1;
            while ( len-- > 0 ) rest[ len ] = arguments[ len + 1 ];

            if (!rest.length && type$k(h) === 'string' && css2rgb.test(h)) {
                return 'css';
            }
        }
    });

    var Color$A = Color_1;
    var chroma$h = chroma_1;
    var input$d = input$h;
    var unpack$t = utils.unpack;

    input$d.format.gl = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var rgb = unpack$t(args, 'rgba');
        rgb[0] *= 255;
        rgb[1] *= 255;
        rgb[2] *= 255;
        return rgb;
    };

    chroma$h.gl = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$A, [ null ].concat( args, ['gl']) ));
    };

    Color$A.prototype.gl = function() {
        var rgb = this._rgb;
        return [rgb[0]/255, rgb[1]/255, rgb[2]/255, rgb[3]];
    };

    var unpack$s = utils.unpack;

    var rgb2hcg$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$s(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var min = Math.min(r, g, b);
        var max = Math.max(r, g, b);
        var delta = max - min;
        var c = delta * 100 / 255;
        var _g = min / (255 - delta) * 100;
        var h;
        if (delta === 0) {
            h = Number.NaN;
        } else {
            if (r === max) { h = (g - b) / delta; }
            if (g === max) { h = 2+(b - r) / delta; }
            if (b === max) { h = 4+(r - g) / delta; }
            h *= 60;
            if (h < 0) { h += 360; }
        }
        return [h, c, _g];
    };

    var rgb2hcg_1 = rgb2hcg$1;

    var unpack$r = utils.unpack;
    var floor$3 = Math.floor;

    /*
     * this is basically just HSV with some minor tweaks
     *
     * hue.. [0..360]
     * chroma .. [0..1]
     * grayness .. [0..1]
     */

    var hcg2rgb = function () {
        var assign, assign$1, assign$2, assign$3, assign$4, assign$5;

        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];
        args = unpack$r(args, 'hcg');
        var h = args[0];
        var c = args[1];
        var _g = args[2];
        var r,g,b;
        _g = _g * 255;
        var _c = c * 255;
        if (c === 0) {
            r = g = b = _g;
        } else {
            if (h === 360) { h = 0; }
            if (h > 360) { h -= 360; }
            if (h < 0) { h += 360; }
            h /= 60;
            var i = floor$3(h);
            var f = h - i;
            var p = _g * (1 - c);
            var q = p + _c * (1 - f);
            var t = p + _c * f;
            var v = p + _c;
            switch (i) {
                case 0: (assign = [v, t, p], r = assign[0], g = assign[1], b = assign[2]); break
                case 1: (assign$1 = [q, v, p], r = assign$1[0], g = assign$1[1], b = assign$1[2]); break
                case 2: (assign$2 = [p, v, t], r = assign$2[0], g = assign$2[1], b = assign$2[2]); break
                case 3: (assign$3 = [p, q, v], r = assign$3[0], g = assign$3[1], b = assign$3[2]); break
                case 4: (assign$4 = [t, p, v], r = assign$4[0], g = assign$4[1], b = assign$4[2]); break
                case 5: (assign$5 = [v, p, q], r = assign$5[0], g = assign$5[1], b = assign$5[2]); break
            }
        }
        return [r, g, b, args.length > 3 ? args[3] : 1];
    };

    var hcg2rgb_1 = hcg2rgb;

    var unpack$q = utils.unpack;
    var type$j = utils.type;
    var chroma$g = chroma_1;
    var Color$z = Color_1;
    var input$c = input$h;

    var rgb2hcg = rgb2hcg_1;

    Color$z.prototype.hcg = function() {
        return rgb2hcg(this._rgb);
    };

    chroma$g.hcg = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$z, [ null ].concat( args, ['hcg']) ));
    };

    input$c.format.hcg = hcg2rgb_1;

    input$c.autodetect.push({
        p: 1,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$q(args, 'hcg');
            if (type$j(args) === 'array' && args.length === 3) {
                return 'hcg';
            }
        }
    });

    var unpack$p = utils.unpack;
    var last = utils.last;
    var round$3 = Math.round;

    var rgb2hex$2 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$p(args, 'rgba');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var a = ref[3];
        var mode = last(args) || 'auto';
        if (a === undefined) { a = 1; }
        if (mode === 'auto') {
            mode = a < 1 ? 'rgba' : 'rgb';
        }
        r = round$3(r);
        g = round$3(g);
        b = round$3(b);
        var u = r << 16 | g << 8 | b;
        var str = "000000" + u.toString(16); //#.toUpperCase();
        str = str.substr(str.length - 6);
        var hxa = '0' + round$3(a * 255).toString(16);
        hxa = hxa.substr(hxa.length - 2);
        switch (mode.toLowerCase()) {
            case 'rgba': return ("#" + str + hxa);
            case 'argb': return ("#" + hxa + str);
            default: return ("#" + str);
        }
    };

    var rgb2hex_1 = rgb2hex$2;

    var RE_HEX = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    var RE_HEXA = /^#?([A-Fa-f0-9]{8}|[A-Fa-f0-9]{4})$/;

    var hex2rgb$1 = function (hex) {
        if (hex.match(RE_HEX)) {
            // remove optional leading #
            if (hex.length === 4 || hex.length === 7) {
                hex = hex.substr(1);
            }
            // expand short-notation to full six-digit
            if (hex.length === 3) {
                hex = hex.split('');
                hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
            }
            var u = parseInt(hex, 16);
            var r = u >> 16;
            var g = u >> 8 & 0xFF;
            var b = u & 0xFF;
            return [r,g,b,1];
        }

        // match rgba hex format, eg #FF000077
        if (hex.match(RE_HEXA)) {
            if (hex.length === 5 || hex.length === 9) {
                // remove optional leading #
                hex = hex.substr(1);
            }
            // expand short-notation to full eight-digit
            if (hex.length === 4) {
                hex = hex.split('');
                hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
            }
            var u$1 = parseInt(hex, 16);
            var r$1 = u$1 >> 24 & 0xFF;
            var g$1 = u$1 >> 16 & 0xFF;
            var b$1 = u$1 >> 8 & 0xFF;
            var a = Math.round((u$1 & 0xFF) / 0xFF * 100) / 100;
            return [r$1,g$1,b$1,a];
        }

        // we used to check for css colors here
        // if _input.css? and rgb = _input.css hex
        //     return rgb

        throw new Error(("unknown hex color: " + hex));
    };

    var hex2rgb_1 = hex2rgb$1;

    var chroma$f = chroma_1;
    var Color$y = Color_1;
    var type$i = utils.type;
    var input$b = input$h;

    var rgb2hex$1 = rgb2hex_1;

    Color$y.prototype.hex = function(mode) {
        return rgb2hex$1(this._rgb, mode);
    };

    chroma$f.hex = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$y, [ null ].concat( args, ['hex']) ));
    };

    input$b.format.hex = hex2rgb_1;
    input$b.autodetect.push({
        p: 4,
        test: function (h) {
            var rest = [], len = arguments.length - 1;
            while ( len-- > 0 ) rest[ len ] = arguments[ len + 1 ];

            if (!rest.length && type$i(h) === 'string' && [3,4,5,6,7,8,9].indexOf(h.length) >= 0) {
                return 'hex';
            }
        }
    });

    var unpack$o = utils.unpack;
    var TWOPI$2 = utils.TWOPI;
    var min$2 = Math.min;
    var sqrt$4 = Math.sqrt;
    var acos = Math.acos;

    var rgb2hsi$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        /*
        borrowed from here:
        http://hummer.stanford.edu/museinfo/doc/examples/humdrum/keyscape2/rgb2hsi.cpp
        */
        var ref = unpack$o(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        r /= 255;
        g /= 255;
        b /= 255;
        var h;
        var min_ = min$2(r,g,b);
        var i = (r+g+b) / 3;
        var s = i > 0 ? 1 - min_/i : 0;
        if (s === 0) {
            h = NaN;
        } else {
            h = ((r-g)+(r-b)) / 2;
            h /= sqrt$4((r-g)*(r-g) + (r-b)*(g-b));
            h = acos(h);
            if (b > g) {
                h = TWOPI$2 - h;
            }
            h /= TWOPI$2;
        }
        return [h*360,s,i];
    };

    var rgb2hsi_1 = rgb2hsi$1;

    var unpack$n = utils.unpack;
    var limit = utils.limit;
    var TWOPI$1 = utils.TWOPI;
    var PITHIRD = utils.PITHIRD;
    var cos$4 = Math.cos;

    /*
     * hue [0..360]
     * saturation [0..1]
     * intensity [0..1]
     */
    var hsi2rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        /*
        borrowed from here:
        http://hummer.stanford.edu/museinfo/doc/examples/humdrum/keyscape2/hsi2rgb.cpp
        */
        args = unpack$n(args, 'hsi');
        var h = args[0];
        var s = args[1];
        var i = args[2];
        var r,g,b;

        if (isNaN(h)) { h = 0; }
        if (isNaN(s)) { s = 0; }
        // normalize hue
        if (h > 360) { h -= 360; }
        if (h < 0) { h += 360; }
        h /= 360;
        if (h < 1/3) {
            b = (1-s)/3;
            r = (1+s*cos$4(TWOPI$1*h)/cos$4(PITHIRD-TWOPI$1*h))/3;
            g = 1 - (b+r);
        } else if (h < 2/3) {
            h -= 1/3;
            r = (1-s)/3;
            g = (1+s*cos$4(TWOPI$1*h)/cos$4(PITHIRD-TWOPI$1*h))/3;
            b = 1 - (r+g);
        } else {
            h -= 2/3;
            g = (1-s)/3;
            b = (1+s*cos$4(TWOPI$1*h)/cos$4(PITHIRD-TWOPI$1*h))/3;
            r = 1 - (g+b);
        }
        r = limit(i*r*3);
        g = limit(i*g*3);
        b = limit(i*b*3);
        return [r*255, g*255, b*255, args.length > 3 ? args[3] : 1];
    };

    var hsi2rgb_1 = hsi2rgb;

    var unpack$m = utils.unpack;
    var type$h = utils.type;
    var chroma$e = chroma_1;
    var Color$x = Color_1;
    var input$a = input$h;

    var rgb2hsi = rgb2hsi_1;

    Color$x.prototype.hsi = function() {
        return rgb2hsi(this._rgb);
    };

    chroma$e.hsi = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$x, [ null ].concat( args, ['hsi']) ));
    };

    input$a.format.hsi = hsi2rgb_1;

    input$a.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$m(args, 'hsi');
            if (type$h(args) === 'array' && args.length === 3) {
                return 'hsi';
            }
        }
    });

    var unpack$l = utils.unpack;
    var type$g = utils.type;
    var chroma$d = chroma_1;
    var Color$w = Color_1;
    var input$9 = input$h;

    var rgb2hsl$1 = rgb2hsl_1;

    Color$w.prototype.hsl = function() {
        return rgb2hsl$1(this._rgb);
    };

    chroma$d.hsl = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$w, [ null ].concat( args, ['hsl']) ));
    };

    input$9.format.hsl = hsl2rgb_1;

    input$9.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$l(args, 'hsl');
            if (type$g(args) === 'array' && args.length === 3) {
                return 'hsl';
            }
        }
    });

    var unpack$k = utils.unpack;
    var min$1 = Math.min;
    var max$1 = Math.max;

    /*
     * supported arguments:
     * - rgb2hsv(r,g,b)
     * - rgb2hsv([r,g,b])
     * - rgb2hsv({r,g,b})
     */
    var rgb2hsl = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$k(args, 'rgb');
        var r = args[0];
        var g = args[1];
        var b = args[2];
        var min_ = min$1(r, g, b);
        var max_ = max$1(r, g, b);
        var delta = max_ - min_;
        var h,s,v;
        v = max_ / 255.0;
        if (max_ === 0) {
            h = Number.NaN;
            s = 0;
        } else {
            s = delta / max_;
            if (r === max_) { h = (g - b) / delta; }
            if (g === max_) { h = 2+(b - r) / delta; }
            if (b === max_) { h = 4+(r - g) / delta; }
            h *= 60;
            if (h < 0) { h += 360; }
        }
        return [h, s, v]
    };

    var rgb2hsv$1 = rgb2hsl;

    var unpack$j = utils.unpack;
    var floor$2 = Math.floor;

    var hsv2rgb = function () {
        var assign, assign$1, assign$2, assign$3, assign$4, assign$5;

        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];
        args = unpack$j(args, 'hsv');
        var h = args[0];
        var s = args[1];
        var v = args[2];
        var r,g,b;
        v *= 255;
        if (s === 0) {
            r = g = b = v;
        } else {
            if (h === 360) { h = 0; }
            if (h > 360) { h -= 360; }
            if (h < 0) { h += 360; }
            h /= 60;

            var i = floor$2(h);
            var f = h - i;
            var p = v * (1 - s);
            var q = v * (1 - s * f);
            var t = v * (1 - s * (1 - f));

            switch (i) {
                case 0: (assign = [v, t, p], r = assign[0], g = assign[1], b = assign[2]); break
                case 1: (assign$1 = [q, v, p], r = assign$1[0], g = assign$1[1], b = assign$1[2]); break
                case 2: (assign$2 = [p, v, t], r = assign$2[0], g = assign$2[1], b = assign$2[2]); break
                case 3: (assign$3 = [p, q, v], r = assign$3[0], g = assign$3[1], b = assign$3[2]); break
                case 4: (assign$4 = [t, p, v], r = assign$4[0], g = assign$4[1], b = assign$4[2]); break
                case 5: (assign$5 = [v, p, q], r = assign$5[0], g = assign$5[1], b = assign$5[2]); break
            }
        }
        return [r,g,b,args.length > 3?args[3]:1];
    };

    var hsv2rgb_1 = hsv2rgb;

    var unpack$i = utils.unpack;
    var type$f = utils.type;
    var chroma$c = chroma_1;
    var Color$v = Color_1;
    var input$8 = input$h;

    var rgb2hsv = rgb2hsv$1;

    Color$v.prototype.hsv = function() {
        return rgb2hsv(this._rgb);
    };

    chroma$c.hsv = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$v, [ null ].concat( args, ['hsv']) ));
    };

    input$8.format.hsv = hsv2rgb_1;

    input$8.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$i(args, 'hsv');
            if (type$f(args) === 'array' && args.length === 3) {
                return 'hsv';
            }
        }
    });

    var labConstants = {
        // Corresponds roughly to RGB brighter/darker
        Kn: 18,

        // D65 standard referent
        Xn: 0.950470,
        Yn: 1,
        Zn: 1.088830,

        t0: 0.137931034,  // 4 / 29
        t1: 0.206896552,  // 6 / 29
        t2: 0.12841855,   // 3 * t1 * t1
        t3: 0.008856452,  // t1 * t1 * t1
    };

    var LAB_CONSTANTS$3 = labConstants;
    var unpack$h = utils.unpack;
    var pow$a = Math.pow;

    var rgb2lab$2 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$h(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var ref$1 = rgb2xyz(r,g,b);
        var x = ref$1[0];
        var y = ref$1[1];
        var z = ref$1[2];
        var l = 116 * y - 16;
        return [l < 0 ? 0 : l, 500 * (x - y), 200 * (y - z)];
    };

    var rgb_xyz = function (r) {
        if ((r /= 255) <= 0.04045) { return r / 12.92; }
        return pow$a((r + 0.055) / 1.055, 2.4);
    };

    var xyz_lab = function (t) {
        if (t > LAB_CONSTANTS$3.t3) { return pow$a(t, 1 / 3); }
        return t / LAB_CONSTANTS$3.t2 + LAB_CONSTANTS$3.t0;
    };

    var rgb2xyz = function (r,g,b) {
        r = rgb_xyz(r);
        g = rgb_xyz(g);
        b = rgb_xyz(b);
        var x = xyz_lab((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / LAB_CONSTANTS$3.Xn);
        var y = xyz_lab((0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / LAB_CONSTANTS$3.Yn);
        var z = xyz_lab((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / LAB_CONSTANTS$3.Zn);
        return [x,y,z];
    };

    var rgb2lab_1 = rgb2lab$2;

    var LAB_CONSTANTS$2 = labConstants;
    var unpack$g = utils.unpack;
    var pow$9 = Math.pow;

    /*
     * L* [0..100]
     * a [-100..100]
     * b [-100..100]
     */
    var lab2rgb$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$g(args, 'lab');
        var l = args[0];
        var a = args[1];
        var b = args[2];
        var x,y,z, r,g,b_;

        y = (l + 16) / 116;
        x = isNaN(a) ? y : y + a / 500;
        z = isNaN(b) ? y : y - b / 200;

        y = LAB_CONSTANTS$2.Yn * lab_xyz(y);
        x = LAB_CONSTANTS$2.Xn * lab_xyz(x);
        z = LAB_CONSTANTS$2.Zn * lab_xyz(z);

        r = xyz_rgb(3.2404542 * x - 1.5371385 * y - 0.4985314 * z);  // D65 -> sRGB
        g = xyz_rgb(-0.9692660 * x + 1.8760108 * y + 0.0415560 * z);
        b_ = xyz_rgb(0.0556434 * x - 0.2040259 * y + 1.0572252 * z);

        return [r,g,b_,args.length > 3 ? args[3] : 1];
    };

    var xyz_rgb = function (r) {
        return 255 * (r <= 0.00304 ? 12.92 * r : 1.055 * pow$9(r, 1 / 2.4) - 0.055)
    };

    var lab_xyz = function (t) {
        return t > LAB_CONSTANTS$2.t1 ? t * t * t : LAB_CONSTANTS$2.t2 * (t - LAB_CONSTANTS$2.t0)
    };

    var lab2rgb_1 = lab2rgb$1;

    var unpack$f = utils.unpack;
    var type$e = utils.type;
    var chroma$b = chroma_1;
    var Color$u = Color_1;
    var input$7 = input$h;

    var rgb2lab$1 = rgb2lab_1;

    Color$u.prototype.lab = function() {
        return rgb2lab$1(this._rgb);
    };

    chroma$b.lab = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$u, [ null ].concat( args, ['lab']) ));
    };

    input$7.format.lab = lab2rgb_1;

    input$7.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$f(args, 'lab');
            if (type$e(args) === 'array' && args.length === 3) {
                return 'lab';
            }
        }
    });

    var unpack$e = utils.unpack;
    var RAD2DEG = utils.RAD2DEG;
    var sqrt$3 = Math.sqrt;
    var atan2$2 = Math.atan2;
    var round$2 = Math.round;

    var lab2lch$2 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$e(args, 'lab');
        var l = ref[0];
        var a = ref[1];
        var b = ref[2];
        var c = sqrt$3(a * a + b * b);
        var h = (atan2$2(b, a) * RAD2DEG + 360) % 360;
        if (round$2(c*10000) === 0) { h = Number.NaN; }
        return [l, c, h];
    };

    var lab2lch_1 = lab2lch$2;

    var unpack$d = utils.unpack;
    var rgb2lab = rgb2lab_1;
    var lab2lch$1 = lab2lch_1;

    var rgb2lch$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$d(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var ref$1 = rgb2lab(r,g,b);
        var l = ref$1[0];
        var a = ref$1[1];
        var b_ = ref$1[2];
        return lab2lch$1(l,a,b_);
    };

    var rgb2lch_1 = rgb2lch$1;

    var unpack$c = utils.unpack;
    var DEG2RAD = utils.DEG2RAD;
    var sin$3 = Math.sin;
    var cos$3 = Math.cos;

    var lch2lab$2 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        /*
        Convert from a qualitative parameter h and a quantitative parameter l to a 24-bit pixel.
        These formulas were invented by David Dalrymple to obtain maximum contrast without going
        out of gamut if the parameters are in the range 0-1.

        A saturation multiplier was added by Gregor Aisch
        */
        var ref = unpack$c(args, 'lch');
        var l = ref[0];
        var c = ref[1];
        var h = ref[2];
        if (isNaN(h)) { h = 0; }
        h = h * DEG2RAD;
        return [l, cos$3(h) * c, sin$3(h) * c]
    };

    var lch2lab_1 = lch2lab$2;

    var unpack$b = utils.unpack;
    var lch2lab$1 = lch2lab_1;
    var lab2rgb = lab2rgb_1;

    var lch2rgb$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$b(args, 'lch');
        var l = args[0];
        var c = args[1];
        var h = args[2];
        var ref = lch2lab$1 (l,c,h);
        var L = ref[0];
        var a = ref[1];
        var b_ = ref[2];
        var ref$1 = lab2rgb (L,a,b_);
        var r = ref$1[0];
        var g = ref$1[1];
        var b = ref$1[2];
        return [r, g, b, args.length > 3 ? args[3] : 1];
    };

    var lch2rgb_1 = lch2rgb$1;

    var unpack$a = utils.unpack;
    var lch2rgb = lch2rgb_1;

    var hcl2rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var hcl = unpack$a(args, 'hcl').reverse();
        return lch2rgb.apply(void 0, hcl);
    };

    var hcl2rgb_1 = hcl2rgb;

    var unpack$9 = utils.unpack;
    var type$d = utils.type;
    var chroma$a = chroma_1;
    var Color$t = Color_1;
    var input$6 = input$h;

    var rgb2lch = rgb2lch_1;

    Color$t.prototype.lch = function() { return rgb2lch(this._rgb); };
    Color$t.prototype.hcl = function() { return rgb2lch(this._rgb).reverse(); };

    chroma$a.lch = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$t, [ null ].concat( args, ['lch']) ));
    };
    chroma$a.hcl = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$t, [ null ].concat( args, ['hcl']) ));
    };

    input$6.format.lch = lch2rgb_1;
    input$6.format.hcl = hcl2rgb_1;

    ['lch','hcl'].forEach(function (m) { return input$6.autodetect.push({
        p: 2,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$9(args, m);
            if (type$d(args) === 'array' && args.length === 3) {
                return m;
            }
        }
    }); });

    /**
    	X11 color names

    	http://www.w3.org/TR/css3-color/#svg-color
    */

    var w3cx11$1 = {
        aliceblue: '#f0f8ff',
        antiquewhite: '#faebd7',
        aqua: '#00ffff',
        aquamarine: '#7fffd4',
        azure: '#f0ffff',
        beige: '#f5f5dc',
        bisque: '#ffe4c4',
        black: '#000000',
        blanchedalmond: '#ffebcd',
        blue: '#0000ff',
        blueviolet: '#8a2be2',
        brown: '#a52a2a',
        burlywood: '#deb887',
        cadetblue: '#5f9ea0',
        chartreuse: '#7fff00',
        chocolate: '#d2691e',
        coral: '#ff7f50',
        cornflower: '#6495ed',
        cornflowerblue: '#6495ed',
        cornsilk: '#fff8dc',
        crimson: '#dc143c',
        cyan: '#00ffff',
        darkblue: '#00008b',
        darkcyan: '#008b8b',
        darkgoldenrod: '#b8860b',
        darkgray: '#a9a9a9',
        darkgreen: '#006400',
        darkgrey: '#a9a9a9',
        darkkhaki: '#bdb76b',
        darkmagenta: '#8b008b',
        darkolivegreen: '#556b2f',
        darkorange: '#ff8c00',
        darkorchid: '#9932cc',
        darkred: '#8b0000',
        darksalmon: '#e9967a',
        darkseagreen: '#8fbc8f',
        darkslateblue: '#483d8b',
        darkslategray: '#2f4f4f',
        darkslategrey: '#2f4f4f',
        darkturquoise: '#00ced1',
        darkviolet: '#9400d3',
        deeppink: '#ff1493',
        deepskyblue: '#00bfff',
        dimgray: '#696969',
        dimgrey: '#696969',
        dodgerblue: '#1e90ff',
        firebrick: '#b22222',
        floralwhite: '#fffaf0',
        forestgreen: '#228b22',
        fuchsia: '#ff00ff',
        gainsboro: '#dcdcdc',
        ghostwhite: '#f8f8ff',
        gold: '#ffd700',
        goldenrod: '#daa520',
        gray: '#808080',
        green: '#008000',
        greenyellow: '#adff2f',
        grey: '#808080',
        honeydew: '#f0fff0',
        hotpink: '#ff69b4',
        indianred: '#cd5c5c',
        indigo: '#4b0082',
        ivory: '#fffff0',
        khaki: '#f0e68c',
        laserlemon: '#ffff54',
        lavender: '#e6e6fa',
        lavenderblush: '#fff0f5',
        lawngreen: '#7cfc00',
        lemonchiffon: '#fffacd',
        lightblue: '#add8e6',
        lightcoral: '#f08080',
        lightcyan: '#e0ffff',
        lightgoldenrod: '#fafad2',
        lightgoldenrodyellow: '#fafad2',
        lightgray: '#d3d3d3',
        lightgreen: '#90ee90',
        lightgrey: '#d3d3d3',
        lightpink: '#ffb6c1',
        lightsalmon: '#ffa07a',
        lightseagreen: '#20b2aa',
        lightskyblue: '#87cefa',
        lightslategray: '#778899',
        lightslategrey: '#778899',
        lightsteelblue: '#b0c4de',
        lightyellow: '#ffffe0',
        lime: '#00ff00',
        limegreen: '#32cd32',
        linen: '#faf0e6',
        magenta: '#ff00ff',
        maroon: '#800000',
        maroon2: '#7f0000',
        maroon3: '#b03060',
        mediumaquamarine: '#66cdaa',
        mediumblue: '#0000cd',
        mediumorchid: '#ba55d3',
        mediumpurple: '#9370db',
        mediumseagreen: '#3cb371',
        mediumslateblue: '#7b68ee',
        mediumspringgreen: '#00fa9a',
        mediumturquoise: '#48d1cc',
        mediumvioletred: '#c71585',
        midnightblue: '#191970',
        mintcream: '#f5fffa',
        mistyrose: '#ffe4e1',
        moccasin: '#ffe4b5',
        navajowhite: '#ffdead',
        navy: '#000080',
        oldlace: '#fdf5e6',
        olive: '#808000',
        olivedrab: '#6b8e23',
        orange: '#ffa500',
        orangered: '#ff4500',
        orchid: '#da70d6',
        palegoldenrod: '#eee8aa',
        palegreen: '#98fb98',
        paleturquoise: '#afeeee',
        palevioletred: '#db7093',
        papayawhip: '#ffefd5',
        peachpuff: '#ffdab9',
        peru: '#cd853f',
        pink: '#ffc0cb',
        plum: '#dda0dd',
        powderblue: '#b0e0e6',
        purple: '#800080',
        purple2: '#7f007f',
        purple3: '#a020f0',
        rebeccapurple: '#663399',
        red: '#ff0000',
        rosybrown: '#bc8f8f',
        royalblue: '#4169e1',
        saddlebrown: '#8b4513',
        salmon: '#fa8072',
        sandybrown: '#f4a460',
        seagreen: '#2e8b57',
        seashell: '#fff5ee',
        sienna: '#a0522d',
        silver: '#c0c0c0',
        skyblue: '#87ceeb',
        slateblue: '#6a5acd',
        slategray: '#708090',
        slategrey: '#708090',
        snow: '#fffafa',
        springgreen: '#00ff7f',
        steelblue: '#4682b4',
        tan: '#d2b48c',
        teal: '#008080',
        thistle: '#d8bfd8',
        tomato: '#ff6347',
        turquoise: '#40e0d0',
        violet: '#ee82ee',
        wheat: '#f5deb3',
        white: '#ffffff',
        whitesmoke: '#f5f5f5',
        yellow: '#ffff00',
        yellowgreen: '#9acd32'
    };

    var w3cx11_1 = w3cx11$1;

    var Color$s = Color_1;
    var input$5 = input$h;
    var type$c = utils.type;

    var w3cx11 = w3cx11_1;
    var hex2rgb = hex2rgb_1;
    var rgb2hex = rgb2hex_1;

    Color$s.prototype.name = function() {
        var hex = rgb2hex(this._rgb, 'rgb');
        for (var i = 0, list = Object.keys(w3cx11); i < list.length; i += 1) {
            var n = list[i];

            if (w3cx11[n] === hex) { return n.toLowerCase(); }
        }
        return hex;
    };

    input$5.format.named = function (name) {
        name = name.toLowerCase();
        if (w3cx11[name]) { return hex2rgb(w3cx11[name]); }
        throw new Error('unknown color name: '+name);
    };

    input$5.autodetect.push({
        p: 5,
        test: function (h) {
            var rest = [], len = arguments.length - 1;
            while ( len-- > 0 ) rest[ len ] = arguments[ len + 1 ];

            if (!rest.length && type$c(h) === 'string' && w3cx11[h.toLowerCase()]) {
                return 'named';
            }
        }
    });

    var unpack$8 = utils.unpack;

    var rgb2num$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$8(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        return (r << 16) + (g << 8) + b;
    };

    var rgb2num_1 = rgb2num$1;

    var type$b = utils.type;

    var num2rgb = function (num) {
        if (type$b(num) == "number" && num >= 0 && num <= 0xFFFFFF) {
            var r = num >> 16;
            var g = (num >> 8) & 0xFF;
            var b = num & 0xFF;
            return [r,g,b,1];
        }
        throw new Error("unknown num color: "+num);
    };

    var num2rgb_1 = num2rgb;

    var chroma$9 = chroma_1;
    var Color$r = Color_1;
    var input$4 = input$h;
    var type$a = utils.type;

    var rgb2num = rgb2num_1;

    Color$r.prototype.num = function() {
        return rgb2num(this._rgb);
    };

    chroma$9.num = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$r, [ null ].concat( args, ['num']) ));
    };

    input$4.format.num = num2rgb_1;

    input$4.autodetect.push({
        p: 5,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            if (args.length === 1 && type$a(args[0]) === 'number' && args[0] >= 0 && args[0] <= 0xFFFFFF) {
                return 'num';
            }
        }
    });

    var chroma$8 = chroma_1;
    var Color$q = Color_1;
    var input$3 = input$h;
    var unpack$7 = utils.unpack;
    var type$9 = utils.type;
    var round$1 = Math.round;

    Color$q.prototype.rgb = function(rnd) {
        if ( rnd === void 0 ) rnd=true;

        if (rnd === false) { return this._rgb.slice(0,3); }
        return this._rgb.slice(0,3).map(round$1);
    };

    Color$q.prototype.rgba = function(rnd) {
        if ( rnd === void 0 ) rnd=true;

        return this._rgb.slice(0,4).map(function (v,i) {
            return i<3 ? (rnd === false ? v : round$1(v)) : v;
        });
    };

    chroma$8.rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$q, [ null ].concat( args, ['rgb']) ));
    };

    input$3.format.rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var rgba = unpack$7(args, 'rgba');
        if (rgba[3] === undefined) { rgba[3] = 1; }
        return rgba;
    };

    input$3.autodetect.push({
        p: 3,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$7(args, 'rgba');
            if (type$9(args) === 'array' && (args.length === 3 ||
                args.length === 4 && type$9(args[3]) == 'number' && args[3] >= 0 && args[3] <= 1)) {
                return 'rgb';
            }
        }
    });

    /*
     * Based on implementation by Neil Bartlett
     * https://github.com/neilbartlett/color-temperature
     */

    var log$1 = Math.log;

    var temperature2rgb$1 = function (kelvin) {
        var temp = kelvin / 100;
        var r,g,b;
        if (temp < 66) {
            r = 255;
            g = temp < 6 ? 0 : -155.25485562709179 - 0.44596950469579133 * (g = temp-2) + 104.49216199393888 * log$1(g);
            b = temp < 20 ? 0 : -254.76935184120902 + 0.8274096064007395 * (b = temp-10) + 115.67994401066147 * log$1(b);
        } else {
            r = 351.97690566805693 + 0.114206453784165 * (r = temp-55) - 40.25366309332127 * log$1(r);
            g = 325.4494125711974 + 0.07943456536662342 * (g = temp-50) - 28.0852963507957 * log$1(g);
            b = 255;
        }
        return [r,g,b,1];
    };

    var temperature2rgb_1 = temperature2rgb$1;

    /*
     * Based on implementation by Neil Bartlett
     * https://github.com/neilbartlett/color-temperature
     **/

    var temperature2rgb = temperature2rgb_1;
    var unpack$6 = utils.unpack;
    var round = Math.round;

    var rgb2temperature$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var rgb = unpack$6(args, 'rgb');
        var r = rgb[0], b = rgb[2];
        var minTemp = 1000;
        var maxTemp = 40000;
        var eps = 0.4;
        var temp;
        while (maxTemp - minTemp > eps) {
            temp = (maxTemp + minTemp) * 0.5;
            var rgb$1 = temperature2rgb(temp);
            if ((rgb$1[2] / rgb$1[0]) >= (b / r)) {
                maxTemp = temp;
            } else {
                minTemp = temp;
            }
        }
        return round(temp);
    };

    var rgb2temperature_1 = rgb2temperature$1;

    var chroma$7 = chroma_1;
    var Color$p = Color_1;
    var input$2 = input$h;

    var rgb2temperature = rgb2temperature_1;

    Color$p.prototype.temp =
    Color$p.prototype.kelvin =
    Color$p.prototype.temperature = function() {
        return rgb2temperature(this._rgb);
    };

    chroma$7.temp =
    chroma$7.kelvin =
    chroma$7.temperature = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$p, [ null ].concat( args, ['temp']) ));
    };

    input$2.format.temp =
    input$2.format.kelvin =
    input$2.format.temperature = temperature2rgb_1;

    var unpack$5 = utils.unpack;
    var cbrt = Math.cbrt;
    var pow$8 = Math.pow;
    var sign$1 = Math.sign;

    var rgb2oklab$2 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        // OKLab color space implementation taken from
        // https://bottosson.github.io/posts/oklab/
        var ref = unpack$5(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var ref$1 = [rgb2lrgb(r / 255), rgb2lrgb(g / 255), rgb2lrgb(b / 255)];
        var lr = ref$1[0];
        var lg = ref$1[1];
        var lb = ref$1[2];
        var l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
        var m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
        var s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

        return [
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        ];
    };

    var rgb2oklab_1 = rgb2oklab$2;

    function rgb2lrgb(c) {
        var abs = Math.abs(c);
        if (abs < 0.04045) {
            return c / 12.92;
        }
        return (sign$1(c) || 1) * pow$8((abs + 0.055) / 1.055, 2.4);
    }

    var unpack$4 = utils.unpack;
    var pow$7 = Math.pow;
    var sign = Math.sign;

    /*
     * L* [0..100]
     * a [-100..100]
     * b [-100..100]
     */
    var oklab2rgb$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$4(args, 'lab');
        var L = args[0];
        var a = args[1];
        var b = args[2];

        var l = pow$7(L + 0.3963377774 * a + 0.2158037573 * b, 3);
        var m = pow$7(L - 0.1055613458 * a - 0.0638541728 * b, 3);
        var s = pow$7(L - 0.0894841775 * a - 1.291485548 * b, 3);

        return [
            255 * lrgb2rgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            255 * lrgb2rgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            255 * lrgb2rgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
            args.length > 3 ? args[3] : 1
        ];
    };

    var oklab2rgb_1 = oklab2rgb$1;

    function lrgb2rgb(c) {
        var abs = Math.abs(c);
        if (abs > 0.0031308) {
            return (sign(c) || 1) * (1.055 * pow$7(abs, 1 / 2.4) - 0.055);
        }
        return c * 12.92;
    }

    var unpack$3 = utils.unpack;
    var type$8 = utils.type;
    var chroma$6 = chroma_1;
    var Color$o = Color_1;
    var input$1 = input$h;

    var rgb2oklab$1 = rgb2oklab_1;

    Color$o.prototype.oklab = function () {
        return rgb2oklab$1(this._rgb);
    };

    chroma$6.oklab = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$o, [ null ].concat( args, ['oklab']) ));
    };

    input$1.format.oklab = oklab2rgb_1;

    input$1.autodetect.push({
        p: 3,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack$3(args, 'oklab');
            if (type$8(args) === 'array' && args.length === 3) {
                return 'oklab';
            }
        }
    });

    var unpack$2 = utils.unpack;
    var rgb2oklab = rgb2oklab_1;
    var lab2lch = lab2lch_1;

    var rgb2oklch$1 = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        var ref = unpack$2(args, 'rgb');
        var r = ref[0];
        var g = ref[1];
        var b = ref[2];
        var ref$1 = rgb2oklab(r, g, b);
        var l = ref$1[0];
        var a = ref$1[1];
        var b_ = ref$1[2];
        return lab2lch(l, a, b_);
    };

    var rgb2oklch_1 = rgb2oklch$1;

    var unpack$1 = utils.unpack;
    var lch2lab = lch2lab_1;
    var oklab2rgb = oklab2rgb_1;

    var oklch2rgb = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        args = unpack$1(args, 'lch');
        var l = args[0];
        var c = args[1];
        var h = args[2];
        var ref = lch2lab(l, c, h);
        var L = ref[0];
        var a = ref[1];
        var b_ = ref[2];
        var ref$1 = oklab2rgb(L, a, b_);
        var r = ref$1[0];
        var g = ref$1[1];
        var b = ref$1[2];
        return [r, g, b, args.length > 3 ? args[3] : 1];
    };

    var oklch2rgb_1 = oklch2rgb;

    var unpack = utils.unpack;
    var type$7 = utils.type;
    var chroma$5 = chroma_1;
    var Color$n = Color_1;
    var input = input$h;

    var rgb2oklch = rgb2oklch_1;

    Color$n.prototype.oklch = function () {
        return rgb2oklch(this._rgb);
    };

    chroma$5.oklch = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        return new (Function.prototype.bind.apply( Color$n, [ null ].concat( args, ['oklch']) ));
    };

    input.format.oklch = oklch2rgb_1;

    input.autodetect.push({
        p: 3,
        test: function () {
            var args = [], len = arguments.length;
            while ( len-- ) args[ len ] = arguments[ len ];

            args = unpack(args, 'oklch');
            if (type$7(args) === 'array' && args.length === 3) {
                return 'oklch';
            }
        }
    });

    var Color$m = Color_1;
    var type$6 = utils.type;

    Color$m.prototype.alpha = function(a, mutate) {
        if ( mutate === void 0 ) mutate=false;

        if (a !== undefined && type$6(a) === 'number') {
            if (mutate) {
                this._rgb[3] = a;
                return this;
            }
            return new Color$m([this._rgb[0], this._rgb[1], this._rgb[2], a], 'rgb');
        }
        return this._rgb[3];
    };

    var Color$l = Color_1;

    Color$l.prototype.clipped = function() {
        return this._rgb._clipped || false;
    };

    var Color$k = Color_1;
    var LAB_CONSTANTS$1 = labConstants;

    Color$k.prototype.darken = function(amount) {
    	if ( amount === void 0 ) amount=1;

    	var me = this;
    	var lab = me.lab();
    	lab[0] -= LAB_CONSTANTS$1.Kn * amount;
    	return new Color$k(lab, 'lab').alpha(me.alpha(), true);
    };

    Color$k.prototype.brighten = function(amount) {
    	if ( amount === void 0 ) amount=1;

    	return this.darken(-amount);
    };

    Color$k.prototype.darker = Color$k.prototype.darken;
    Color$k.prototype.brighter = Color$k.prototype.brighten;

    var Color$j = Color_1;

    Color$j.prototype.get = function (mc) {
        var ref = mc.split('.');
        var mode = ref[0];
        var channel = ref[1];
        var src = this[mode]();
        if (channel) {
            var i = mode.indexOf(channel) - (mode.substr(0, 2) === 'ok' ? 2 : 0);
            if (i > -1) { return src[i]; }
            throw new Error(("unknown channel " + channel + " in mode " + mode));
        } else {
            return src;
        }
    };

    var Color$i = Color_1;
    var type$5 = utils.type;
    var pow$6 = Math.pow;

    var EPS = 1e-7;
    var MAX_ITER = 20;

    Color$i.prototype.luminance = function(lum) {
        if (lum !== undefined && type$5(lum) === 'number') {
            if (lum === 0) {
                // return pure black
                return new Color$i([0,0,0,this._rgb[3]], 'rgb');
            }
            if (lum === 1) {
                // return pure white
                return new Color$i([255,255,255,this._rgb[3]], 'rgb');
            }
            // compute new color using...
            var cur_lum = this.luminance();
            var mode = 'rgb';
            var max_iter = MAX_ITER;

            var test = function (low, high) {
                var mid = low.interpolate(high, 0.5, mode);
                var lm = mid.luminance();
                if (Math.abs(lum - lm) < EPS || !max_iter--) {
                    // close enough
                    return mid;
                }
                return lm > lum ? test(low, mid) : test(mid, high);
            };

            var rgb = (cur_lum > lum ? test(new Color$i([0,0,0]), this) : test(this, new Color$i([255,255,255]))).rgb();
            return new Color$i(rgb.concat( [this._rgb[3]]));
        }
        return rgb2luminance.apply(void 0, (this._rgb).slice(0,3));
    };


    var rgb2luminance = function (r,g,b) {
        // relative luminance
        // see http://www.w3.org/TR/2008/REC-WCAG20-20081211/#relativeluminancedef
        r = luminance_x(r);
        g = luminance_x(g);
        b = luminance_x(b);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    var luminance_x = function (x) {
        x /= 255;
        return x <= 0.03928 ? x/12.92 : pow$6((x+0.055)/1.055, 2.4);
    };

    var interpolator$1 = {};

    var Color$h = Color_1;
    var type$4 = utils.type;
    var interpolator = interpolator$1;

    var mix$1 = function (col1, col2, f) {
        if ( f === void 0 ) f=0.5;
        var rest = [], len = arguments.length - 3;
        while ( len-- > 0 ) rest[ len ] = arguments[ len + 3 ];

        var mode = rest[0] || 'lrgb';
        if (!interpolator[mode] && !rest.length) {
            // fall back to the first supported mode
            mode = Object.keys(interpolator)[0];
        }
        if (!interpolator[mode]) {
            throw new Error(("interpolation mode " + mode + " is not defined"));
        }
        if (type$4(col1) !== 'object') { col1 = new Color$h(col1); }
        if (type$4(col2) !== 'object') { col2 = new Color$h(col2); }
        return interpolator[mode](col1, col2, f)
            .alpha(col1.alpha() + f * (col2.alpha() - col1.alpha()));
    };

    var Color$g = Color_1;
    var mix = mix$1;

    Color$g.prototype.mix =
    Color$g.prototype.interpolate = function(col2, f) {
    	if ( f === void 0 ) f=0.5;
    	var rest = [], len = arguments.length - 2;
    	while ( len-- > 0 ) rest[ len ] = arguments[ len + 2 ];

    	return mix.apply(void 0, [ this, col2, f ].concat( rest ));
    };

    var Color$f = Color_1;

    Color$f.prototype.premultiply = function(mutate) {
    	if ( mutate === void 0 ) mutate=false;

    	var rgb = this._rgb;
    	var a = rgb[3];
    	if (mutate) {
    		this._rgb = [rgb[0]*a, rgb[1]*a, rgb[2]*a, a];
    		return this;
    	} else {
    		return new Color$f([rgb[0]*a, rgb[1]*a, rgb[2]*a, a], 'rgb');
    	}
    };

    var Color$e = Color_1;
    var LAB_CONSTANTS = labConstants;

    Color$e.prototype.saturate = function(amount) {
    	if ( amount === void 0 ) amount=1;

    	var me = this;
    	var lch = me.lch();
    	lch[1] += LAB_CONSTANTS.Kn * amount;
    	if (lch[1] < 0) { lch[1] = 0; }
    	return new Color$e(lch, 'lch').alpha(me.alpha(), true);
    };

    Color$e.prototype.desaturate = function(amount) {
    	if ( amount === void 0 ) amount=1;

    	return this.saturate(-amount);
    };

    var Color$d = Color_1;
    var type$3 = utils.type;

    Color$d.prototype.set = function (mc, value, mutate) {
        if ( mutate === void 0 ) mutate = false;

        var ref = mc.split('.');
        var mode = ref[0];
        var channel = ref[1];
        var src = this[mode]();
        if (channel) {
            var i = mode.indexOf(channel) - (mode.substr(0, 2) === 'ok' ? 2 : 0);
            if (i > -1) {
                if (type$3(value) == 'string') {
                    switch (value.charAt(0)) {
                        case '+':
                            src[i] += +value;
                            break;
                        case '-':
                            src[i] += +value;
                            break;
                        case '*':
                            src[i] *= +value.substr(1);
                            break;
                        case '/':
                            src[i] /= +value.substr(1);
                            break;
                        default:
                            src[i] = +value;
                    }
                } else if (type$3(value) === 'number') {
                    src[i] = value;
                } else {
                    throw new Error("unsupported value for Color.set");
                }
                var out = new Color$d(src, mode);
                if (mutate) {
                    this._rgb = out._rgb;
                    return this;
                }
                return out;
            }
            throw new Error(("unknown channel " + channel + " in mode " + mode));
        } else {
            return src;
        }
    };

    var Color$c = Color_1;

    var rgb = function (col1, col2, f) {
        var xyz0 = col1._rgb;
        var xyz1 = col2._rgb;
        return new Color$c(
            xyz0[0] + f * (xyz1[0]-xyz0[0]),
            xyz0[1] + f * (xyz1[1]-xyz0[1]),
            xyz0[2] + f * (xyz1[2]-xyz0[2]),
            'rgb'
        )
    };

    // register interpolator
    interpolator$1.rgb = rgb;

    var Color$b = Color_1;
    var sqrt$2 = Math.sqrt;
    var pow$5 = Math.pow;

    var lrgb = function (col1, col2, f) {
        var ref = col1._rgb;
        var x1 = ref[0];
        var y1 = ref[1];
        var z1 = ref[2];
        var ref$1 = col2._rgb;
        var x2 = ref$1[0];
        var y2 = ref$1[1];
        var z2 = ref$1[2];
        return new Color$b(
            sqrt$2(pow$5(x1,2) * (1-f) + pow$5(x2,2) * f),
            sqrt$2(pow$5(y1,2) * (1-f) + pow$5(y2,2) * f),
            sqrt$2(pow$5(z1,2) * (1-f) + pow$5(z2,2) * f),
            'rgb'
        )
    };

    // register interpolator
    interpolator$1.lrgb = lrgb;

    var Color$a = Color_1;

    var lab = function (col1, col2, f) {
        var xyz0 = col1.lab();
        var xyz1 = col2.lab();
        return new Color$a(
            xyz0[0] + f * (xyz1[0]-xyz0[0]),
            xyz0[1] + f * (xyz1[1]-xyz0[1]),
            xyz0[2] + f * (xyz1[2]-xyz0[2]),
            'lab'
        )
    };

    // register interpolator
    interpolator$1.lab = lab;

    var Color$9 = Color_1;

    var _hsx = function (col1, col2, f, m) {
        var assign, assign$1;

        var xyz0, xyz1;
        if (m === 'hsl') {
            xyz0 = col1.hsl();
            xyz1 = col2.hsl();
        } else if (m === 'hsv') {
            xyz0 = col1.hsv();
            xyz1 = col2.hsv();
        } else if (m === 'hcg') {
            xyz0 = col1.hcg();
            xyz1 = col2.hcg();
        } else if (m === 'hsi') {
            xyz0 = col1.hsi();
            xyz1 = col2.hsi();
        } else if (m === 'lch' || m === 'hcl') {
            m = 'hcl';
            xyz0 = col1.hcl();
            xyz1 = col2.hcl();
        } else if (m === 'oklch') {
            xyz0 = col1.oklch().reverse();
            xyz1 = col2.oklch().reverse();
        }

        var hue0, hue1, sat0, sat1, lbv0, lbv1;
        if (m.substr(0, 1) === 'h' || m === 'oklch') {
            (assign = xyz0, hue0 = assign[0], sat0 = assign[1], lbv0 = assign[2]);
            (assign$1 = xyz1, hue1 = assign$1[0], sat1 = assign$1[1], lbv1 = assign$1[2]);
        }

        var sat, hue, lbv, dh;

        if (!isNaN(hue0) && !isNaN(hue1)) {
            // both colors have hue
            if (hue1 > hue0 && hue1 - hue0 > 180) {
                dh = hue1 - (hue0 + 360);
            } else if (hue1 < hue0 && hue0 - hue1 > 180) {
                dh = hue1 + 360 - hue0;
            } else {
                dh = hue1 - hue0;
            }
            hue = hue0 + f * dh;
        } else if (!isNaN(hue0)) {
            hue = hue0;
            if ((lbv1 == 1 || lbv1 == 0) && m != 'hsv') { sat = sat0; }
        } else if (!isNaN(hue1)) {
            hue = hue1;
            if ((lbv0 == 1 || lbv0 == 0) && m != 'hsv') { sat = sat1; }
        } else {
            hue = Number.NaN;
        }

        if (sat === undefined) { sat = sat0 + f * (sat1 - sat0); }
        lbv = lbv0 + f * (lbv1 - lbv0);
        return m === 'oklch' ? new Color$9([lbv, sat, hue], m) : new Color$9([hue, sat, lbv], m);
    };

    var interpolate_hsx$5 = _hsx;

    var lch = function (col1, col2, f) {
    	return interpolate_hsx$5(col1, col2, f, 'lch');
    };

    // register interpolator
    interpolator$1.lch = lch;
    interpolator$1.hcl = lch;

    var Color$8 = Color_1;

    var num = function (col1, col2, f) {
        var c1 = col1.num();
        var c2 = col2.num();
        return new Color$8(c1 + f * (c2-c1), 'num')
    };

    // register interpolator
    interpolator$1.num = num;

    var interpolate_hsx$4 = _hsx;

    var hcg = function (col1, col2, f) {
    	return interpolate_hsx$4(col1, col2, f, 'hcg');
    };

    // register interpolator
    interpolator$1.hcg = hcg;

    var interpolate_hsx$3 = _hsx;

    var hsi = function (col1, col2, f) {
    	return interpolate_hsx$3(col1, col2, f, 'hsi');
    };

    // register interpolator
    interpolator$1.hsi = hsi;

    var interpolate_hsx$2 = _hsx;

    var hsl = function (col1, col2, f) {
    	return interpolate_hsx$2(col1, col2, f, 'hsl');
    };

    // register interpolator
    interpolator$1.hsl = hsl;

    var interpolate_hsx$1 = _hsx;

    var hsv = function (col1, col2, f) {
    	return interpolate_hsx$1(col1, col2, f, 'hsv');
    };

    // register interpolator
    interpolator$1.hsv = hsv;

    var Color$7 = Color_1;

    var oklab = function (col1, col2, f) {
        var xyz0 = col1.oklab();
        var xyz1 = col2.oklab();
        return new Color$7(
            xyz0[0] + f * (xyz1[0] - xyz0[0]),
            xyz0[1] + f * (xyz1[1] - xyz0[1]),
            xyz0[2] + f * (xyz1[2] - xyz0[2]),
            'oklab'
        );
    };

    // register interpolator
    interpolator$1.oklab = oklab;

    var interpolate_hsx = _hsx;

    var oklch = function (col1, col2, f) {
        return interpolate_hsx(col1, col2, f, 'oklch');
    };

    // register interpolator
    interpolator$1.oklch = oklch;

    var Color$6 = Color_1;
    var clip_rgb$1 = utils.clip_rgb;
    var pow$4 = Math.pow;
    var sqrt$1 = Math.sqrt;
    var PI$1 = Math.PI;
    var cos$2 = Math.cos;
    var sin$2 = Math.sin;
    var atan2$1 = Math.atan2;

    var average = function (colors, mode, weights) {
        if ( mode === void 0 ) mode='lrgb';
        if ( weights === void 0 ) weights=null;

        var l = colors.length;
        if (!weights) { weights = Array.from(new Array(l)).map(function () { return 1; }); }
        // normalize weights
        var k = l / weights.reduce(function(a, b) { return a + b; });
        weights.forEach(function (w,i) { weights[i] *= k; });
        // convert colors to Color objects
        colors = colors.map(function (c) { return new Color$6(c); });
        if (mode === 'lrgb') {
            return _average_lrgb(colors, weights)
        }
        var first = colors.shift();
        var xyz = first.get(mode);
        var cnt = [];
        var dx = 0;
        var dy = 0;
        // initial color
        for (var i=0; i<xyz.length; i++) {
            xyz[i] = (xyz[i] || 0) * weights[0];
            cnt.push(isNaN(xyz[i]) ? 0 : weights[0]);
            if (mode.charAt(i) === 'h' && !isNaN(xyz[i])) {
                var A = xyz[i] / 180 * PI$1;
                dx += cos$2(A) * weights[0];
                dy += sin$2(A) * weights[0];
            }
        }

        var alpha = first.alpha() * weights[0];
        colors.forEach(function (c,ci) {
            var xyz2 = c.get(mode);
            alpha += c.alpha() * weights[ci+1];
            for (var i=0; i<xyz.length; i++) {
                if (!isNaN(xyz2[i])) {
                    cnt[i] += weights[ci+1];
                    if (mode.charAt(i) === 'h') {
                        var A = xyz2[i] / 180 * PI$1;
                        dx += cos$2(A) * weights[ci+1];
                        dy += sin$2(A) * weights[ci+1];
                    } else {
                        xyz[i] += xyz2[i] * weights[ci+1];
                    }
                }
            }
        });

        for (var i$1=0; i$1<xyz.length; i$1++) {
            if (mode.charAt(i$1) === 'h') {
                var A$1 = atan2$1(dy / cnt[i$1], dx / cnt[i$1]) / PI$1 * 180;
                while (A$1 < 0) { A$1 += 360; }
                while (A$1 >= 360) { A$1 -= 360; }
                xyz[i$1] = A$1;
            } else {
                xyz[i$1] = xyz[i$1]/cnt[i$1];
            }
        }
        alpha /= l;
        return (new Color$6(xyz, mode)).alpha(alpha > 0.99999 ? 1 : alpha, true);
    };


    var _average_lrgb = function (colors, weights) {
        var l = colors.length;
        var xyz = [0,0,0,0];
        for (var i=0; i < colors.length; i++) {
            var col = colors[i];
            var f = weights[i] / l;
            var rgb = col._rgb;
            xyz[0] += pow$4(rgb[0],2) * f;
            xyz[1] += pow$4(rgb[1],2) * f;
            xyz[2] += pow$4(rgb[2],2) * f;
            xyz[3] += rgb[3] * f;
        }
        xyz[0] = sqrt$1(xyz[0]);
        xyz[1] = sqrt$1(xyz[1]);
        xyz[2] = sqrt$1(xyz[2]);
        if (xyz[3] > 0.9999999) { xyz[3] = 1; }
        return new Color$6(clip_rgb$1(xyz));
    };

    // minimal multi-purpose interface

    // @requires utils color analyze

    var chroma$4 = chroma_1;
    var type$2 = utils.type;

    var pow$3 = Math.pow;

    var scale$2 = function(colors) {

        // constructor
        var _mode = 'rgb';
        var _nacol = chroma$4('#ccc');
        var _spread = 0;
        // const _fixed = false;
        var _domain = [0, 1];
        var _pos = [];
        var _padding = [0,0];
        var _classes = false;
        var _colors = [];
        var _out = false;
        var _min = 0;
        var _max = 1;
        var _correctLightness = false;
        var _colorCache = {};
        var _useCache = true;
        var _gamma = 1;

        // private methods

        var setColors = function(colors) {
            colors = colors || ['#fff', '#000'];
            if (colors && type$2(colors) === 'string' && chroma$4.brewer &&
                chroma$4.brewer[colors.toLowerCase()]) {
                colors = chroma$4.brewer[colors.toLowerCase()];
            }
            if (type$2(colors) === 'array') {
                // handle single color
                if (colors.length === 1) {
                    colors = [colors[0], colors[0]];
                }
                // make a copy of the colors
                colors = colors.slice(0);
                // convert to chroma classes
                for (var c=0; c<colors.length; c++) {
                    colors[c] = chroma$4(colors[c]);
                }
                // auto-fill color position
                _pos.length = 0;
                for (var c$1=0; c$1<colors.length; c$1++) {
                    _pos.push(c$1/(colors.length-1));
                }
            }
            resetCache();
            return _colors = colors;
        };

        var getClass = function(value) {
            if (_classes != null) {
                var n = _classes.length-1;
                var i = 0;
                while (i < n && value >= _classes[i]) {
                    i++;
                }
                return i-1;
            }
            return 0;
        };

        var tMapLightness = function (t) { return t; };
        var tMapDomain = function (t) { return t; };

        // const classifyValue = function(value) {
        //     let val = value;
        //     if (_classes.length > 2) {
        //         const n = _classes.length-1;
        //         const i = getClass(value);
        //         const minc = _classes[0] + ((_classes[1]-_classes[0]) * (0 + (_spread * 0.5)));  // center of 1st class
        //         const maxc = _classes[n-1] + ((_classes[n]-_classes[n-1]) * (1 - (_spread * 0.5)));  // center of last class
        //         val = _min + ((((_classes[i] + ((_classes[i+1] - _classes[i]) * 0.5)) - minc) / (maxc-minc)) * (_max - _min));
        //     }
        //     return val;
        // };

        var getColor = function(val, bypassMap) {
            var col, t;
            if (bypassMap == null) { bypassMap = false; }
            if (isNaN(val) || (val === null)) { return _nacol; }
            if (!bypassMap) {
                if (_classes && (_classes.length > 2)) {
                    // find the class
                    var c = getClass(val);
                    t = c / (_classes.length-2);
                } else if (_max !== _min) {
                    // just interpolate between min/max
                    t = (val - _min) / (_max - _min);
                } else {
                    t = 1;
                }
            } else {
                t = val;
            }

            // domain map
            t = tMapDomain(t);

            if (!bypassMap) {
                t = tMapLightness(t);  // lightness correction
            }

            if (_gamma !== 1) { t = pow$3(t, _gamma); }

            t = _padding[0] + (t * (1 - _padding[0] - _padding[1]));

            t = Math.min(1, Math.max(0, t));

            var k = Math.floor(t * 10000);

            if (_useCache && _colorCache[k]) {
                col = _colorCache[k];
            } else {
                if (type$2(_colors) === 'array') {
                    //for i in [0.._pos.length-1]
                    for (var i=0; i<_pos.length; i++) {
                        var p = _pos[i];
                        if (t <= p) {
                            col = _colors[i];
                            break;
                        }
                        if ((t >= p) && (i === (_pos.length-1))) {
                            col = _colors[i];
                            break;
                        }
                        if (t > p && t < _pos[i+1]) {
                            t = (t-p)/(_pos[i+1]-p);
                            col = chroma$4.interpolate(_colors[i], _colors[i+1], t, _mode);
                            break;
                        }
                    }
                } else if (type$2(_colors) === 'function') {
                    col = _colors(t);
                }
                if (_useCache) { _colorCache[k] = col; }
            }
            return col;
        };

        var resetCache = function () { return _colorCache = {}; };

        setColors(colors);

        // public interface

        var f = function(v) {
            var c = chroma$4(getColor(v));
            if (_out && c[_out]) { return c[_out](); } else { return c; }
        };

        f.classes = function(classes) {
            if (classes != null) {
                if (type$2(classes) === 'array') {
                    _classes = classes;
                    _domain = [classes[0], classes[classes.length-1]];
                } else {
                    var d = chroma$4.analyze(_domain);
                    if (classes === 0) {
                        _classes = [d.min, d.max];
                    } else {
                        _classes = chroma$4.limits(d, 'e', classes);
                    }
                }
                return f;
            }
            return _classes;
        };


        f.domain = function(domain) {
            if (!arguments.length) {
                return _domain;
            }
            _min = domain[0];
            _max = domain[domain.length-1];
            _pos = [];
            var k = _colors.length;
            if ((domain.length === k) && (_min !== _max)) {
                // update positions
                for (var i = 0, list = Array.from(domain); i < list.length; i += 1) {
                    var d = list[i];

                  _pos.push((d-_min) / (_max-_min));
                }
            } else {
                for (var c=0; c<k; c++) {
                    _pos.push(c/(k-1));
                }
                if (domain.length > 2) {
                    // set domain map
                    var tOut = domain.map(function (d,i) { return i/(domain.length-1); });
                    var tBreaks = domain.map(function (d) { return (d - _min) / (_max - _min); });
                    if (!tBreaks.every(function (val, i) { return tOut[i] === val; })) {
                        tMapDomain = function (t) {
                            if (t <= 0 || t >= 1) { return t; }
                            var i = 0;
                            while (t >= tBreaks[i+1]) { i++; }
                            var f = (t - tBreaks[i]) / (tBreaks[i+1] - tBreaks[i]);
                            var out = tOut[i] + f * (tOut[i+1] - tOut[i]);
                            return out;
                        };
                    }

                }
            }
            _domain = [_min, _max];
            return f;
        };

        f.mode = function(_m) {
            if (!arguments.length) {
                return _mode;
            }
            _mode = _m;
            resetCache();
            return f;
        };

        f.range = function(colors, _pos) {
            setColors(colors);
            return f;
        };

        f.out = function(_o) {
            _out = _o;
            return f;
        };

        f.spread = function(val) {
            if (!arguments.length) {
                return _spread;
            }
            _spread = val;
            return f;
        };

        f.correctLightness = function(v) {
            if (v == null) { v = true; }
            _correctLightness = v;
            resetCache();
            if (_correctLightness) {
                tMapLightness = function(t) {
                    var L0 = getColor(0, true).lab()[0];
                    var L1 = getColor(1, true).lab()[0];
                    var pol = L0 > L1;
                    var L_actual = getColor(t, true).lab()[0];
                    var L_ideal = L0 + ((L1 - L0) * t);
                    var L_diff = L_actual - L_ideal;
                    var t0 = 0;
                    var t1 = 1;
                    var max_iter = 20;
                    while ((Math.abs(L_diff) > 1e-2) && (max_iter-- > 0)) {
                        (function() {
                            if (pol) { L_diff *= -1; }
                            if (L_diff < 0) {
                                t0 = t;
                                t += (t1 - t) * 0.5;
                            } else {
                                t1 = t;
                                t += (t0 - t) * 0.5;
                            }
                            L_actual = getColor(t, true).lab()[0];
                            return L_diff = L_actual - L_ideal;
                        })();
                    }
                    return t;
                };
            } else {
                tMapLightness = function (t) { return t; };
            }
            return f;
        };

        f.padding = function(p) {
            if (p != null) {
                if (type$2(p) === 'number') {
                    p = [p,p];
                }
                _padding = p;
                return f;
            } else {
                return _padding;
            }
        };

        f.colors = function(numColors, out) {
            // If no arguments are given, return the original colors that were provided
            if (arguments.length < 2) { out = 'hex'; }
            var result = [];

            if (arguments.length === 0) {
                result = _colors.slice(0);

            } else if (numColors === 1) {
                result = [f(0.5)];

            } else if (numColors > 1) {
                var dm = _domain[0];
                var dd = _domain[1] - dm;
                result = __range__(0, numColors, false).map(function (i) { return f( dm + ((i/(numColors-1)) * dd) ); });

            } else { // returns all colors based on the defined classes
                colors = [];
                var samples = [];
                if (_classes && (_classes.length > 2)) {
                    for (var i = 1, end = _classes.length, asc = 1 <= end; asc ? i < end : i > end; asc ? i++ : i--) {
                        samples.push((_classes[i-1]+_classes[i])*0.5);
                    }
                } else {
                    samples = _domain;
                }
                result = samples.map(function (v) { return f(v); });
            }

            if (chroma$4[out]) {
                result = result.map(function (c) { return c[out](); });
            }
            return result;
        };

        f.cache = function(c) {
            if (c != null) {
                _useCache = c;
                return f;
            } else {
                return _useCache;
            }
        };

        f.gamma = function(g) {
            if (g != null) {
                _gamma = g;
                return f;
            } else {
                return _gamma;
            }
        };

        f.nodata = function(d) {
            if (d != null) {
                _nacol = chroma$4(d);
                return f;
            } else {
                return _nacol;
            }
        };

        return f;
    };

    function __range__(left, right, inclusive) {
      var range = [];
      var ascending = left < right;
      var end = !inclusive ? right : ascending ? right + 1 : right - 1;
      for (var i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
        range.push(i);
      }
      return range;
    }

    //
    // interpolates between a set of colors uzing a bezier spline
    //

    // @requires utils lab
    var Color$5 = Color_1;

    var scale$1 = scale$2;

    // nth row of the pascal triangle
    var binom_row = function(n) {
        var row = [1, 1];
        for (var i = 1; i < n; i++) {
            var newrow = [1];
            for (var j = 1; j <= row.length; j++) {
                newrow[j] = (row[j] || 0) + row[j - 1];
            }
            row = newrow;
        }
        return row;
    };

    var bezier = function(colors) {
        var assign, assign$1, assign$2;

        var I, lab0, lab1, lab2;
        colors = colors.map(function (c) { return new Color$5(c); });
        if (colors.length === 2) {
            // linear interpolation
            (assign = colors.map(function (c) { return c.lab(); }), lab0 = assign[0], lab1 = assign[1]);
            I = function(t) {
                var lab = ([0, 1, 2].map(function (i) { return lab0[i] + (t * (lab1[i] - lab0[i])); }));
                return new Color$5(lab, 'lab');
            };
        } else if (colors.length === 3) {
            // quadratic bezier interpolation
            (assign$1 = colors.map(function (c) { return c.lab(); }), lab0 = assign$1[0], lab1 = assign$1[1], lab2 = assign$1[2]);
            I = function(t) {
                var lab = ([0, 1, 2].map(function (i) { return ((1-t)*(1-t) * lab0[i]) + (2 * (1-t) * t * lab1[i]) + (t * t * lab2[i]); }));
                return new Color$5(lab, 'lab');
            };
        } else if (colors.length === 4) {
            // cubic bezier interpolation
            var lab3;
            (assign$2 = colors.map(function (c) { return c.lab(); }), lab0 = assign$2[0], lab1 = assign$2[1], lab2 = assign$2[2], lab3 = assign$2[3]);
            I = function(t) {
                var lab = ([0, 1, 2].map(function (i) { return ((1-t)*(1-t)*(1-t) * lab0[i]) + (3 * (1-t) * (1-t) * t * lab1[i]) + (3 * (1-t) * t * t * lab2[i]) + (t*t*t * lab3[i]); }));
                return new Color$5(lab, 'lab');
            };
        } else if (colors.length >= 5) {
            // general case (degree n bezier)
            var labs, row, n;
            labs = colors.map(function (c) { return c.lab(); });
            n = colors.length - 1;
            row = binom_row(n);
            I = function (t) {
                var u = 1 - t;
                var lab = ([0, 1, 2].map(function (i) { return labs.reduce(function (sum, el, j) { return (sum + row[j] * Math.pow( u, (n - j) ) * Math.pow( t, j ) * el[i]); }, 0); }));
                return new Color$5(lab, 'lab');
            };
        } else {
            throw new RangeError("No point in running bezier with only one color.")
        }
        return I;
    };

    var bezier_1 = function (colors) {
        var f = bezier(colors);
        f.scale = function () { return scale$1(f); };
        return f;
    };

    /*
     * interpolates between a set of colors uzing a bezier spline
     * blend mode formulas taken from http://www.venture-ware.com/kevin/coding/lets-learn-math-photoshop-blend-modes/
     */

    var chroma$3 = chroma_1;

    var blend = function (bottom, top, mode) {
        if (!blend[mode]) {
            throw new Error('unknown blend mode ' + mode);
        }
        return blend[mode](bottom, top);
    };

    var blend_f = function (f) { return function (bottom,top) {
            var c0 = chroma$3(top).rgb();
            var c1 = chroma$3(bottom).rgb();
            return chroma$3.rgb(f(c0, c1));
        }; };

    var each = function (f) { return function (c0, c1) {
            var out = [];
            out[0] = f(c0[0], c1[0]);
            out[1] = f(c0[1], c1[1]);
            out[2] = f(c0[2], c1[2]);
            return out;
        }; };

    var normal = function (a) { return a; };
    var multiply = function (a,b) { return a * b / 255; };
    var darken = function (a,b) { return a > b ? b : a; };
    var lighten = function (a,b) { return a > b ? a : b; };
    var screen = function (a,b) { return 255 * (1 - (1-a/255) * (1-b/255)); };
    var overlay = function (a,b) { return b < 128 ? 2 * a * b / 255 : 255 * (1 - 2 * (1 - a / 255 ) * ( 1 - b / 255 )); };
    var burn = function (a,b) { return 255 * (1 - (1 - b / 255) / (a/255)); };
    var dodge = function (a,b) {
        if (a === 255) { return 255; }
        a = 255 * (b / 255) / (1 - a / 255);
        return a > 255 ? 255 : a
    };

    // # add = (a,b) ->
    // #     if (a + b > 255) then 255 else a + b

    blend.normal = blend_f(each(normal));
    blend.multiply = blend_f(each(multiply));
    blend.screen = blend_f(each(screen));
    blend.overlay = blend_f(each(overlay));
    blend.darken = blend_f(each(darken));
    blend.lighten = blend_f(each(lighten));
    blend.dodge = blend_f(each(dodge));
    blend.burn = blend_f(each(burn));
    // blend.add = blend_f(each(add));

    var blend_1 = blend;

    // cubehelix interpolation
    // based on D.A. Green "A colour scheme for the display of astronomical intensity images"
    // http://astron-soc.in/bulletin/11June/289392011.pdf

    var type$1 = utils.type;
    var clip_rgb = utils.clip_rgb;
    var TWOPI = utils.TWOPI;
    var pow$2 = Math.pow;
    var sin$1 = Math.sin;
    var cos$1 = Math.cos;
    var chroma$2 = chroma_1;

    var cubehelix = function(start, rotations, hue, gamma, lightness) {
        if ( start === void 0 ) start=300;
        if ( rotations === void 0 ) rotations=-1.5;
        if ( hue === void 0 ) hue=1;
        if ( gamma === void 0 ) gamma=1;
        if ( lightness === void 0 ) lightness=[0,1];

        var dh = 0, dl;
        if (type$1(lightness) === 'array') {
            dl = lightness[1] - lightness[0];
        } else {
            dl = 0;
            lightness = [lightness, lightness];
        }

        var f = function(fract) {
            var a = TWOPI * (((start+120)/360) + (rotations * fract));
            var l = pow$2(lightness[0] + (dl * fract), gamma);
            var h = dh !== 0 ? hue[0] + (fract * dh) : hue;
            var amp = (h * l * (1-l)) / 2;
            var cos_a = cos$1(a);
            var sin_a = sin$1(a);
            var r = l + (amp * ((-0.14861 * cos_a) + (1.78277* sin_a)));
            var g = l + (amp * ((-0.29227 * cos_a) - (0.90649* sin_a)));
            var b = l + (amp * (+1.97294 * cos_a));
            return chroma$2(clip_rgb([r*255,g*255,b*255,1]));
        };

        f.start = function(s) {
            if ((s == null)) { return start; }
            start = s;
            return f;
        };

        f.rotations = function(r) {
            if ((r == null)) { return rotations; }
            rotations = r;
            return f;
        };

        f.gamma = function(g) {
            if ((g == null)) { return gamma; }
            gamma = g;
            return f;
        };

        f.hue = function(h) {
            if ((h == null)) { return hue; }
            hue = h;
            if (type$1(hue) === 'array') {
                dh = hue[1] - hue[0];
                if (dh === 0) { hue = hue[1]; }
            } else {
                dh = 0;
            }
            return f;
        };

        f.lightness = function(h) {
            if ((h == null)) { return lightness; }
            if (type$1(h) === 'array') {
                lightness = h;
                dl = h[1] - h[0];
            } else {
                lightness = [h,h];
                dl = 0;
            }
            return f;
        };

        f.scale = function () { return chroma$2.scale(f); };

        f.hue(hue);

        return f;
    };

    var Color$4 = Color_1;
    var digits = '0123456789abcdef';

    var floor$1 = Math.floor;
    var random = Math.random;

    var random_1 = function () {
        var code = '#';
        for (var i=0; i<6; i++) {
            code += digits.charAt(floor$1(random() * 16));
        }
        return new Color$4(code, 'hex');
    };

    var type = type$p;
    var log = Math.log;
    var pow$1 = Math.pow;
    var floor = Math.floor;
    var abs$1 = Math.abs;


    var analyze = function (data, key) {
        if ( key === void 0 ) key=null;

        var r = {
            min: Number.MAX_VALUE,
            max: Number.MAX_VALUE*-1,
            sum: 0,
            values: [],
            count: 0
        };
        if (type(data) === 'object') {
            data = Object.values(data);
        }
        data.forEach(function (val) {
            if (key && type(val) === 'object') { val = val[key]; }
            if (val !== undefined && val !== null && !isNaN(val)) {
                r.values.push(val);
                r.sum += val;
                if (val < r.min) { r.min = val; }
                if (val > r.max) { r.max = val; }
                r.count += 1;
            }
        });

        r.domain = [r.min, r.max];

        r.limits = function (mode, num) { return limits(r, mode, num); };

        return r;
    };


    var limits = function (data, mode, num) {
        if ( mode === void 0 ) mode='equal';
        if ( num === void 0 ) num=7;

        if (type(data) == 'array') {
            data = analyze(data);
        }
        var min = data.min;
        var max = data.max;
        var values = data.values.sort(function (a,b) { return a-b; });

        if (num === 1) { return [min,max]; }

        var limits = [];

        if (mode.substr(0,1) === 'c') { // continuous
            limits.push(min);
            limits.push(max);
        }

        if (mode.substr(0,1) === 'e') { // equal interval
            limits.push(min);
            for (var i=1; i<num; i++) {
                limits.push(min+((i/num)*(max-min)));
            }
            limits.push(max);
        }

        else if (mode.substr(0,1) === 'l') { // log scale
            if (min <= 0) {
                throw new Error('Logarithmic scales are only possible for values > 0');
            }
            var min_log = Math.LOG10E * log(min);
            var max_log = Math.LOG10E * log(max);
            limits.push(min);
            for (var i$1=1; i$1<num; i$1++) {
                limits.push(pow$1(10, min_log + ((i$1/num) * (max_log - min_log))));
            }
            limits.push(max);
        }

        else if (mode.substr(0,1) === 'q') { // quantile scale
            limits.push(min);
            for (var i$2=1; i$2<num; i$2++) {
                var p = ((values.length-1) * i$2)/num;
                var pb = floor(p);
                if (pb === p) {
                    limits.push(values[pb]);
                } else { // p > pb
                    var pr = p - pb;
                    limits.push((values[pb]*(1-pr)) + (values[pb+1]*pr));
                }
            }
            limits.push(max);

        }

        else if (mode.substr(0,1) === 'k') { // k-means clustering
            /*
            implementation based on
            http://code.google.com/p/figue/source/browse/trunk/figue.js#336
            simplified for 1-d input values
            */
            var cluster;
            var n = values.length;
            var assignments = new Array(n);
            var clusterSizes = new Array(num);
            var repeat = true;
            var nb_iters = 0;
            var centroids = null;

            // get seed values
            centroids = [];
            centroids.push(min);
            for (var i$3=1; i$3<num; i$3++) {
                centroids.push(min + ((i$3/num) * (max-min)));
            }
            centroids.push(max);

            while (repeat) {
                // assignment step
                for (var j=0; j<num; j++) {
                    clusterSizes[j] = 0;
                }
                for (var i$4=0; i$4<n; i$4++) {
                    var value = values[i$4];
                    var mindist = Number.MAX_VALUE;
                    var best = (void 0);
                    for (var j$1=0; j$1<num; j$1++) {
                        var dist = abs$1(centroids[j$1]-value);
                        if (dist < mindist) {
                            mindist = dist;
                            best = j$1;
                        }
                        clusterSizes[best]++;
                        assignments[i$4] = best;
                    }
                }

                // update centroids step
                var newCentroids = new Array(num);
                for (var j$2=0; j$2<num; j$2++) {
                    newCentroids[j$2] = null;
                }
                for (var i$5=0; i$5<n; i$5++) {
                    cluster = assignments[i$5];
                    if (newCentroids[cluster] === null) {
                        newCentroids[cluster] = values[i$5];
                    } else {
                        newCentroids[cluster] += values[i$5];
                    }
                }
                for (var j$3=0; j$3<num; j$3++) {
                    newCentroids[j$3] *= 1/clusterSizes[j$3];
                }

                // check convergence
                repeat = false;
                for (var j$4=0; j$4<num; j$4++) {
                    if (newCentroids[j$4] !== centroids[j$4]) {
                        repeat = true;
                        break;
                    }
                }

                centroids = newCentroids;
                nb_iters++;

                if (nb_iters > 200) {
                    repeat = false;
                }
            }

            // finished k-means clustering
            // the next part is borrowed from gabrielflor.it
            var kClusters = {};
            for (var j$5=0; j$5<num; j$5++) {
                kClusters[j$5] = [];
            }
            for (var i$6=0; i$6<n; i$6++) {
                cluster = assignments[i$6];
                kClusters[cluster].push(values[i$6]);
            }
            var tmpKMeansBreaks = [];
            for (var j$6=0; j$6<num; j$6++) {
                tmpKMeansBreaks.push(kClusters[j$6][0]);
                tmpKMeansBreaks.push(kClusters[j$6][kClusters[j$6].length-1]);
            }
            tmpKMeansBreaks = tmpKMeansBreaks.sort(function (a,b){ return a-b; });
            limits.push(tmpKMeansBreaks[0]);
            for (var i$7=1; i$7 < tmpKMeansBreaks.length; i$7+= 2) {
                var v = tmpKMeansBreaks[i$7];
                if (!isNaN(v) && (limits.indexOf(v) === -1)) {
                    limits.push(v);
                }
            }
        }
        return limits;
    };

    var analyze_1 = {analyze: analyze, limits: limits};

    var Color$3 = Color_1;


    var contrast = function (a, b) {
        // WCAG contrast ratio
        // see http://www.w3.org/TR/2008/REC-WCAG20-20081211/#contrast-ratiodef
        a = new Color$3(a);
        b = new Color$3(b);
        var l1 = a.luminance();
        var l2 = b.luminance();
        return l1 > l2 ? (l1 + 0.05) / (l2 + 0.05) : (l2 + 0.05) / (l1 + 0.05);
    };

    var Color$2 = Color_1;
    var sqrt = Math.sqrt;
    var pow = Math.pow;
    var min = Math.min;
    var max = Math.max;
    var atan2 = Math.atan2;
    var abs = Math.abs;
    var cos = Math.cos;
    var sin = Math.sin;
    var exp = Math.exp;
    var PI = Math.PI;

    var deltaE = function(a, b, Kl, Kc, Kh) {
        if ( Kl === void 0 ) Kl=1;
        if ( Kc === void 0 ) Kc=1;
        if ( Kh === void 0 ) Kh=1;

        // Delta E (CIE 2000)
        // see http://www.brucelindbloom.com/index.html?Eqn_DeltaE_CIE2000.html
        var rad2deg = function(rad) {
            return 360 * rad / (2 * PI);
        };
        var deg2rad = function(deg) {
            return (2 * PI * deg) / 360;
        };
        a = new Color$2(a);
        b = new Color$2(b);
        var ref = Array.from(a.lab());
        var L1 = ref[0];
        var a1 = ref[1];
        var b1 = ref[2];
        var ref$1 = Array.from(b.lab());
        var L2 = ref$1[0];
        var a2 = ref$1[1];
        var b2 = ref$1[2];
        var avgL = (L1 + L2)/2;
        var C1 = sqrt(pow(a1, 2) + pow(b1, 2));
        var C2 = sqrt(pow(a2, 2) + pow(b2, 2));
        var avgC = (C1 + C2)/2;
        var G = 0.5*(1-sqrt(pow(avgC, 7)/(pow(avgC, 7) + pow(25, 7))));
        var a1p = a1*(1+G);
        var a2p = a2*(1+G);
        var C1p = sqrt(pow(a1p, 2) + pow(b1, 2));
        var C2p = sqrt(pow(a2p, 2) + pow(b2, 2));
        var avgCp = (C1p + C2p)/2;
        var arctan1 = rad2deg(atan2(b1, a1p));
        var arctan2 = rad2deg(atan2(b2, a2p));
        var h1p = arctan1 >= 0 ? arctan1 : arctan1 + 360;
        var h2p = arctan2 >= 0 ? arctan2 : arctan2 + 360;
        var avgHp = abs(h1p - h2p) > 180 ? (h1p + h2p + 360)/2 : (h1p + h2p)/2;
        var T = 1 - 0.17*cos(deg2rad(avgHp - 30)) + 0.24*cos(deg2rad(2*avgHp)) + 0.32*cos(deg2rad(3*avgHp + 6)) - 0.2*cos(deg2rad(4*avgHp - 63));
        var deltaHp = h2p - h1p;
        deltaHp = abs(deltaHp) <= 180 ? deltaHp : h2p <= h1p ? deltaHp + 360 : deltaHp - 360;
        deltaHp = 2*sqrt(C1p*C2p)*sin(deg2rad(deltaHp)/2);
        var deltaL = L2 - L1;
        var deltaCp = C2p - C1p;    
        var sl = 1 + (0.015*pow(avgL - 50, 2))/sqrt(20 + pow(avgL - 50, 2));
        var sc = 1 + 0.045*avgCp;
        var sh = 1 + 0.015*avgCp*T;
        var deltaTheta = 30*exp(-pow((avgHp - 275)/25, 2));
        var Rc = 2*sqrt(pow(avgCp, 7)/(pow(avgCp, 7) + pow(25, 7)));
        var Rt = -Rc*sin(2*deg2rad(deltaTheta));
        var result = sqrt(pow(deltaL/(Kl*sl), 2) + pow(deltaCp/(Kc*sc), 2) + pow(deltaHp/(Kh*sh), 2) + Rt*(deltaCp/(Kc*sc))*(deltaHp/(Kh*sh)));
        return max(0, min(100, result));
    };

    var Color$1 = Color_1;

    // simple Euclidean distance
    var distance = function(a, b, mode) {
        if ( mode === void 0 ) mode='lab';

        // Delta E (CIE 1976)
        // see http://www.brucelindbloom.com/index.html?Equations.html
        a = new Color$1(a);
        b = new Color$1(b);
        var l1 = a.get(mode);
        var l2 = b.get(mode);
        var sum_sq = 0;
        for (var i in l1) {
            var d = (l1[i] || 0) - (l2[i] || 0);
            sum_sq += d*d;
        }
        return Math.sqrt(sum_sq);
    };

    var Color = Color_1;

    var valid = function () {
        var args = [], len = arguments.length;
        while ( len-- ) args[ len ] = arguments[ len ];

        try {
            new (Function.prototype.bind.apply( Color, [ null ].concat( args) ));
            return true;
        } catch (e) {
            return false;
        }
    };

    // some pre-defined color scales:
    var chroma$1 = chroma_1;

    var scale = scale$2;

    var scales = {
    	cool: function cool() { return scale([chroma$1.hsl(180,1,.9), chroma$1.hsl(250,.7,.4)]) },
    	hot: function hot() { return scale(['#000','#f00','#ff0','#fff']).mode('rgb') }
    };

    /**
        ColorBrewer colors for chroma.js

        Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The
        Pennsylvania State University.

        Licensed under the Apache License, Version 2.0 (the "License");
        you may not use this file except in compliance with the License.
        You may obtain a copy of the License at
        http://www.apache.org/licenses/LICENSE-2.0

        Unless required by applicable law or agreed to in writing, software distributed
        under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
        CONDITIONS OF ANY KIND, either express or implied. See the License for the
        specific language governing permissions and limitations under the License.
    */

    var colorbrewer = {
        // sequential
        OrRd: ['#fff7ec', '#fee8c8', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#d7301f', '#b30000', '#7f0000'],
        PuBu: ['#fff7fb', '#ece7f2', '#d0d1e6', '#a6bddb', '#74a9cf', '#3690c0', '#0570b0', '#045a8d', '#023858'],
        BuPu: ['#f7fcfd', '#e0ecf4', '#bfd3e6', '#9ebcda', '#8c96c6', '#8c6bb1', '#88419d', '#810f7c', '#4d004b'],
        Oranges: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
        BuGn: ['#f7fcfd', '#e5f5f9', '#ccece6', '#99d8c9', '#66c2a4', '#41ae76', '#238b45', '#006d2c', '#00441b'],
        YlOrBr: ['#ffffe5', '#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#993404', '#662506'],
        YlGn: ['#ffffe5', '#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#41ab5d', '#238443', '#006837', '#004529'],
        Reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
        RdPu: ['#fff7f3', '#fde0dd', '#fcc5c0', '#fa9fb5', '#f768a1', '#dd3497', '#ae017e', '#7a0177', '#49006a'],
        Greens: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
        YlGnBu: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
        Purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
        GnBu: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#0868ac', '#084081'],
        Greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
        YlOrRd: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
        PuRd: ['#f7f4f9', '#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#980043', '#67001f'],
        Blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
        PuBuGn: ['#fff7fb', '#ece2f0', '#d0d1e6', '#a6bddb', '#67a9cf', '#3690c0', '#02818a', '#016c59', '#014636'],
        Viridis: ['#440154', '#482777', '#3f4a8a', '#31678e', '#26838f', '#1f9d8a', '#6cce5a', '#b6de2b', '#fee825'],

        // diverging

        Spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
        RdYlGn: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
        RdBu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
        PiYG: ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#f7f7f7', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221', '#276419'],
        PRGn: ['#40004b', '#762a83', '#9970ab', '#c2a5cf', '#e7d4e8', '#f7f7f7', '#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#00441b'],
        RdYlBu: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'],
        BrBG: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
        RdGy: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#ffffff', '#e0e0e0', '#bababa', '#878787', '#4d4d4d', '#1a1a1a'],
        PuOr: ['#7f3b08', '#b35806', '#e08214', '#fdb863', '#fee0b6', '#f7f7f7', '#d8daeb', '#b2abd2', '#8073ac', '#542788', '#2d004b'],

        // qualitative

        Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
        Accent: ['#7fc97f', '#beaed4', '#fdc086', '#ffff99', '#386cb0', '#f0027f', '#bf5b17', '#666666'],
        Set1: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
        Set3: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
        Dark2: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
        Paired: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928'],
        Pastel2: ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc'],
        Pastel1: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2'],
    };

    // add lowercase aliases for case-insensitive matches
    for (var i = 0, list = Object.keys(colorbrewer); i < list.length; i += 1) {
        var key = list[i];

        colorbrewer[key.toLowerCase()] = colorbrewer[key];
    }

    var colorbrewer_1 = colorbrewer;

    var chroma = chroma_1;

    // feel free to comment out anything to rollup
    // a smaller chroma.js built

    // io --> convert colors

















    // operators --> modify existing Colors










    // interpolators












    // generators -- > create new colors
    chroma.average = average;
    chroma.bezier = bezier_1;
    chroma.blend = blend_1;
    chroma.cubehelix = cubehelix;
    chroma.mix = chroma.interpolate = mix$1;
    chroma.random = random_1;
    chroma.scale = scale$2;

    // other utility methods
    chroma.analyze = analyze_1.analyze;
    chroma.contrast = contrast;
    chroma.deltaE = deltaE;
    chroma.distance = distance;
    chroma.limits = analyze_1.limits;
    chroma.valid = valid;

    // scale
    chroma.scales = scales;

    // colors
    chroma.colors = w3cx11_1;
    chroma.brewer = colorbrewer_1;

    var chroma_js = chroma;

    return chroma_js;

}));

},{}],27:[function(require,module,exports){
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],28:[function(require,module,exports){
// Top level file is just a mixin of submodules & constants
'use strict';

const { Deflate, deflate, deflateRaw, gzip } = require('./lib/deflate');

const { Inflate, inflate, inflateRaw, ungzip } = require('./lib/inflate');

const constants = require('./lib/zlib/constants');

module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = ungzip;
module.exports.constants = constants;

},{"./lib/deflate":29,"./lib/inflate":30,"./lib/zlib/constants":34}],29:[function(require,module,exports){
'use strict';


const zlib_deflate = require('./zlib/deflate');
const utils        = require('./utils/common');
const strings      = require('./utils/strings');
const msg          = require('./zlib/messages');
const ZStream      = require('./zlib/zstream');

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END,
  Z_DEFAULT_COMPRESSION,
  Z_DEFAULT_STRATEGY,
  Z_DEFLATED
} = require('./zlib/constants');

/* ===========================================================================*/


/**
 * class Deflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[deflate]],
 * [[deflateRaw]] and [[gzip]].
 **/

/* internal
 * Deflate.chunks -> Array
 *
 * Chunks of output data, if [[Deflate#onData]] not overridden.
 **/

/**
 * Deflate.result -> Uint8Array
 *
 * Compressed result, generated by default [[Deflate#onData]]
 * and [[Deflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Deflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Deflate.err -> Number
 *
 * Error code after deflate finished. 0 (Z_OK) on success.
 * You will not need it in real life, because deflate errors
 * are possible only on wrong options or bad `onData` / `onEnd`
 * custom handlers.
 **/

/**
 * Deflate.msg -> String
 *
 * Error message, if [[Deflate.err]] != 0
 **/


/**
 * new Deflate(options)
 * - options (Object): zlib deflate options.
 *
 * Creates new deflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `level`
 * - `windowBits`
 * - `memLevel`
 * - `strategy`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw deflate
 * - `gzip` (Boolean) - create gzip wrapper
 * - `header` (Object) - custom header for gzip
 *   - `text` (Boolean) - true if compressed data believed to be text
 *   - `time` (Number) - modification time, unix timestamp
 *   - `os` (Number) - operation system code
 *   - `extra` (Array) - array of bytes with extra data (max 65536)
 *   - `name` (String) - file name (binary string)
 *   - `comment` (String) - comment (binary string)
 *   - `hcrc` (Boolean) - true if header crc should be added
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 *   , chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 *   , chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const deflate = new pako.Deflate({ level: 3});
 *
 * deflate.push(chunk1, false);
 * deflate.push(chunk2, true);  // true -> last chunk
 *
 * if (deflate.err) { throw new Error(deflate.err); }
 *
 * console.log(deflate.result);
 * ```
 **/
function Deflate(options) {
  this.options = utils.assign({
    level: Z_DEFAULT_COMPRESSION,
    method: Z_DEFLATED,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: Z_DEFAULT_STRATEGY
  }, options || {});

  let opt = this.options;

  if (opt.raw && (opt.windowBits > 0)) {
    opt.windowBits = -opt.windowBits;
  }

  else if (opt.gzip && (opt.windowBits > 0) && (opt.windowBits < 16)) {
    opt.windowBits += 16;
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm = new ZStream();
  this.strm.avail_out = 0;

  let status = zlib_deflate.deflateInit2(
    this.strm,
    opt.level,
    opt.method,
    opt.windowBits,
    opt.memLevel,
    opt.strategy
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  if (opt.header) {
    zlib_deflate.deflateSetHeader(this.strm, opt.header);
  }

  if (opt.dictionary) {
    let dict;
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      // If we need to compress text, change encoding to utf8.
      dict = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      dict = new Uint8Array(opt.dictionary);
    } else {
      dict = opt.dictionary;
    }

    status = zlib_deflate.deflateSetDictionary(this.strm, dict);

    if (status !== Z_OK) {
      throw new Error(msg[status]);
    }

    this._dict_set = true;
  }
}

/**
 * Deflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer|String): input data. Strings will be
 *   converted to utf8 byte sequence.
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.
 *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` means Z_FINISH.
 *
 * Sends input data to deflate pipe, generating [[Deflate#onData]] calls with
 * new compressed chunks. Returns `true` on success. The last data block must
 * have `flush_mode` Z_FINISH (or `true`). That will flush internal pending
 * buffers and call [[Deflate#onEnd]].
 *
 * On fail call [[Deflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Deflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  let status, _flush_mode;

  if (this.ended) { return false; }

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (typeof data === 'string') {
    // If we need to compress text, change encoding to utf8.
    strm.input = strings.string2buf(data);
  } else if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    // Make sure avail_out > 6 to avoid repeating markers
    if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    status = zlib_deflate.deflate(strm, _flush_mode);

    // Ended => flush and finish
    if (status === Z_STREAM_END) {
      if (strm.next_out > 0) {
        this.onData(strm.output.subarray(0, strm.next_out));
      }
      status = zlib_deflate.deflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return status === Z_OK;
    }

    // Flush if out buffer full
    if (strm.avail_out === 0) {
      this.onData(strm.output);
      continue;
    }

    // Flush if requested and has data
    if (_flush_mode > 0 && strm.next_out > 0) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Deflate#onData(chunk) -> Void
 * - chunk (Uint8Array): output data.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Deflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Deflate#onEnd(status) -> Void
 * - status (Number): deflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called once after you tell deflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Deflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    this.result = utils.flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * deflate(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * Compress `data` with deflate algorithm and `options`.
 *
 * Supported options are:
 *
 * - level
 * - windowBits
 * - memLevel
 * - strategy
 * - dictionary
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const data = new Uint8Array([1,2,3,4,5,6,7,8,9]);
 *
 * console.log(pako.deflate(data));
 * ```
 **/
function deflate(input, options) {
  const deflator = new Deflate(options);

  deflator.push(input, true);

  // That will never happens, if you don't cheat with options :)
  if (deflator.err) { throw deflator.msg || msg[deflator.err]; }

  return deflator.result;
}


/**
 * deflateRaw(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function deflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return deflate(input, options);
}


/**
 * gzip(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but create gzip wrapper instead of
 * deflate one.
 **/
function gzip(input, options) {
  options = options || {};
  options.gzip = true;
  return deflate(input, options);
}


module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.constants = require('./zlib/constants');

},{"./utils/common":31,"./utils/strings":32,"./zlib/constants":34,"./zlib/deflate":36,"./zlib/messages":41,"./zlib/zstream":43}],30:[function(require,module,exports){
'use strict';


const zlib_inflate = require('./zlib/inflate');
const utils        = require('./utils/common');
const strings      = require('./utils/strings');
const msg          = require('./zlib/messages');
const ZStream      = require('./zlib/zstream');
const GZheader     = require('./zlib/gzheader');

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR
} = require('./zlib/constants');

/* ===========================================================================*/


/**
 * class Inflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[inflate]]
 * and [[inflateRaw]].
 **/

/* internal
 * inflate.chunks -> Array
 *
 * Chunks of output data, if [[Inflate#onData]] not overridden.
 **/

/**
 * Inflate.result -> Uint8Array|String
 *
 * Uncompressed result, generated by default [[Inflate#onData]]
 * and [[Inflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Inflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Inflate.err -> Number
 *
 * Error code after inflate finished. 0 (Z_OK) on success.
 * Should be checked if broken data possible.
 **/

/**
 * Inflate.msg -> String
 *
 * Error message, if [[Inflate.err]] != 0
 **/


/**
 * new Inflate(options)
 * - options (Object): zlib inflate options.
 *
 * Creates new inflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `windowBits`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw inflate
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 * By default, when no options set, autodetect deflate/gzip data format via
 * wrapper header.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 * const chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const inflate = new pako.Inflate({ level: 3});
 *
 * inflate.push(chunk1, false);
 * inflate.push(chunk2, true);  // true -> last chunk
 *
 * if (inflate.err) { throw new Error(inflate.err); }
 *
 * console.log(inflate.result);
 * ```
 **/
function Inflate(options) {
  this.options = utils.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ''
  }, options || {});

  const opt = this.options;

  // Force window size for `raw` data, if not set directly,
  // because we have no header for autodetect.
  if (opt.raw && (opt.windowBits >= 0) && (opt.windowBits < 16)) {
    opt.windowBits = -opt.windowBits;
    if (opt.windowBits === 0) { opt.windowBits = -15; }
  }

  // If `windowBits` not defined (and mode not raw) - set autodetect flag for gzip/deflate
  if ((opt.windowBits >= 0) && (opt.windowBits < 16) &&
      !(options && options.windowBits)) {
    opt.windowBits += 32;
  }

  // Gzip header has no info about windows size, we can do autodetect only
  // for deflate. So, if window size not set, force it to max when gzip possible
  if ((opt.windowBits > 15) && (opt.windowBits < 48)) {
    // bit 3 (16) -> gzipped data
    // bit 4 (32) -> autodetect gzip/deflate
    if ((opt.windowBits & 15) === 0) {
      opt.windowBits |= 15;
    }
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm   = new ZStream();
  this.strm.avail_out = 0;

  let status  = zlib_inflate.inflateInit2(
    this.strm,
    opt.windowBits
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  this.header = new GZheader();

  zlib_inflate.inflateGetHeader(this.strm, this.header);

  // Setup dictionary
  if (opt.dictionary) {
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      opt.dictionary = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      opt.dictionary = new Uint8Array(opt.dictionary);
    }
    if (opt.raw) { //In raw mode we need to set the dictionary early
      status = zlib_inflate.inflateSetDictionary(this.strm, opt.dictionary);
      if (status !== Z_OK) {
        throw new Error(msg[status]);
      }
    }
  }
}

/**
 * Inflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer): input data
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE
 *   flush modes. See constants. Skipped or `false` means Z_NO_FLUSH,
 *   `true` means Z_FINISH.
 *
 * Sends input data to inflate pipe, generating [[Inflate#onData]] calls with
 * new output chunks. Returns `true` on success. If end of stream detected,
 * [[Inflate#onEnd]] will be called.
 *
 * `flush_mode` is not needed for normal operation, because end of stream
 * detected automatically. You may try to use it for advanced things, but
 * this functionality was not tested.
 *
 * On fail call [[Inflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Inflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  const dictionary = this.options.dictionary;
  let status, _flush_mode, last_avail_out;

  if (this.ended) return false;

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    status = zlib_inflate.inflate(strm, _flush_mode);

    if (status === Z_NEED_DICT && dictionary) {
      status = zlib_inflate.inflateSetDictionary(strm, dictionary);

      if (status === Z_OK) {
        status = zlib_inflate.inflate(strm, _flush_mode);
      } else if (status === Z_DATA_ERROR) {
        // Replace code with more verbose
        status = Z_NEED_DICT;
      }
    }

    // Skip snyc markers if more data follows and not raw mode
    while (strm.avail_in > 0 &&
           status === Z_STREAM_END &&
           strm.state.wrap > 0 &&
           data[strm.next_in] !== 0)
    {
      zlib_inflate.inflateReset(strm);
      status = zlib_inflate.inflate(strm, _flush_mode);
    }

    switch (status) {
      case Z_STREAM_ERROR:
      case Z_DATA_ERROR:
      case Z_NEED_DICT:
      case Z_MEM_ERROR:
        this.onEnd(status);
        this.ended = true;
        return false;
    }

    // Remember real `avail_out` value, because we may patch out buffer content
    // to align utf8 strings boundaries.
    last_avail_out = strm.avail_out;

    if (strm.next_out) {
      if (strm.avail_out === 0 || status === Z_STREAM_END) {

        if (this.options.to === 'string') {

          let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);

          let tail = strm.next_out - next_out_utf8;
          let utf8str = strings.buf2string(strm.output, next_out_utf8);

          // move tail & realign counters
          strm.next_out = tail;
          strm.avail_out = chunkSize - tail;
          if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);

          this.onData(utf8str);

        } else {
          this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
        }
      }
    }

    // Must repeat iteration if out buffer is full
    if (status === Z_OK && last_avail_out === 0) continue;

    // Finalize if end of stream reached.
    if (status === Z_STREAM_END) {
      status = zlib_inflate.inflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return true;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Inflate#onData(chunk) -> Void
 * - chunk (Uint8Array|String): output data. When string output requested,
 *   each chunk will be string.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Inflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Inflate#onEnd(status) -> Void
 * - status (Number): inflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called either after you tell inflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Inflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    if (this.options.to === 'string') {
      this.result = this.chunks.join('');
    } else {
      this.result = utils.flattenChunks(this.chunks);
    }
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * inflate(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Decompress `data` with inflate/ungzip and `options`. Autodetect
 * format via wrapper header by default. That's why we don't provide
 * separate `ungzip` method.
 *
 * Supported options are:
 *
 * - windowBits
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako');
 * const input = pako.deflate(new Uint8Array([1,2,3,4,5,6,7,8,9]));
 * let output;
 *
 * try {
 *   output = pako.inflate(input);
 * } catch (err) {
 *   console.log(err);
 * }
 * ```
 **/
function inflate(input, options) {
  const inflator = new Inflate(options);

  inflator.push(input);

  // That will never happens, if you don't cheat with options :)
  if (inflator.err) throw inflator.msg || msg[inflator.err];

  return inflator.result;
}


/**
 * inflateRaw(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * The same as [[inflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function inflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return inflate(input, options);
}


/**
 * ungzip(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Just shortcut to [[inflate]], because it autodetects format
 * by header.content. Done for convenience.
 **/


module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = inflate;
module.exports.constants = require('./zlib/constants');

},{"./utils/common":31,"./utils/strings":32,"./zlib/constants":34,"./zlib/gzheader":37,"./zlib/inflate":39,"./zlib/messages":41,"./zlib/zstream":43}],31:[function(require,module,exports){
'use strict';


const _has = (obj, key) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

module.exports.assign = function (obj /*from1, from2, from3, ...*/) {
  const sources = Array.prototype.slice.call(arguments, 1);
  while (sources.length) {
    const source = sources.shift();
    if (!source) { continue; }

    if (typeof source !== 'object') {
      throw new TypeError(source + 'must be non-object');
    }

    for (const p in source) {
      if (_has(source, p)) {
        obj[p] = source[p];
      }
    }
  }

  return obj;
};


// Join array of chunks to single array.
module.exports.flattenChunks = (chunks) => {
  // calculate data length
  let len = 0;

  for (let i = 0, l = chunks.length; i < l; i++) {
    len += chunks[i].length;
  }

  // join chunks
  const result = new Uint8Array(len);

  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
};

},{}],32:[function(require,module,exports){
// String encode/decode helpers
'use strict';


// Quick check if we can use fast array to bin string conversion
//
// - apply(Array) can fail on Android 2.2
// - apply(Uint8Array) can fail on iOS 5.1 Safari
//
let STR_APPLY_UIA_OK = true;

try { String.fromCharCode.apply(null, new Uint8Array(1)); } catch (__) { STR_APPLY_UIA_OK = false; }


// Table with utf8 lengths (calculated by first byte of sequence)
// Note, that 5 & 6-byte values and some 4-byte values can not be represented in JS,
// because max possible codepoint is 0x10ffff
const _utf8len = new Uint8Array(256);
for (let q = 0; q < 256; q++) {
  _utf8len[q] = (q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1);
}
_utf8len[254] = _utf8len[254] = 1; // Invalid sequence start


// convert string to array (typed, when possible)
module.exports.string2buf = (str) => {
  if (typeof TextEncoder === 'function' && TextEncoder.prototype.encode) {
    return new TextEncoder().encode(str);
  }

  let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;

  // count binary size
  for (m_pos = 0; m_pos < str_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    buf_len += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  // allocate buffer
  buf = new Uint8Array(buf_len);

  // convert
  for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    if (c < 0x80) {
      /* one byte */
      buf[i++] = c;
    } else if (c < 0x800) {
      /* two bytes */
      buf[i++] = 0xC0 | (c >>> 6);
      buf[i++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      /* three bytes */
      buf[i++] = 0xE0 | (c >>> 12);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    } else {
      /* four bytes */
      buf[i++] = 0xf0 | (c >>> 18);
      buf[i++] = 0x80 | (c >>> 12 & 0x3f);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    }
  }

  return buf;
};

// Helper
const buf2binstring = (buf, len) => {
  // On Chrome, the arguments in a function call that are allowed is `65534`.
  // If the length of the buffer is smaller than that, we can use this optimization,
  // otherwise we will take a slower path.
  if (len < 65534) {
    if (buf.subarray && STR_APPLY_UIA_OK) {
      return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
    }
  }

  let result = '';
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
};


// convert array to string
module.exports.buf2string = (buf, max) => {
  const len = max || buf.length;

  if (typeof TextDecoder === 'function' && TextDecoder.prototype.decode) {
    return new TextDecoder().decode(buf.subarray(0, max));
  }

  let i, out;

  // Reserve max possible length (2 words per char)
  // NB: by unknown reasons, Array is significantly faster for
  //     String.fromCharCode.apply than Uint16Array.
  const utf16buf = new Array(len * 2);

  for (out = 0, i = 0; i < len;) {
    let c = buf[i++];
    // quick process ascii
    if (c < 0x80) { utf16buf[out++] = c; continue; }

    let c_len = _utf8len[c];
    // skip 5 & 6 byte codes
    if (c_len > 4) { utf16buf[out++] = 0xfffd; i += c_len - 1; continue; }

    // apply mask on first byte
    c &= c_len === 2 ? 0x1f : c_len === 3 ? 0x0f : 0x07;
    // join the rest
    while (c_len > 1 && i < len) {
      c = (c << 6) | (buf[i++] & 0x3f);
      c_len--;
    }

    // terminated by end of string?
    if (c_len > 1) { utf16buf[out++] = 0xfffd; continue; }

    if (c < 0x10000) {
      utf16buf[out++] = c;
    } else {
      c -= 0x10000;
      utf16buf[out++] = 0xd800 | ((c >> 10) & 0x3ff);
      utf16buf[out++] = 0xdc00 | (c & 0x3ff);
    }
  }

  return buf2binstring(utf16buf, out);
};


// Calculate max possible position in utf8 buffer,
// that will not break sequence. If that's not possible
// - (very small limits) return max size as is.
//
// buf[] - utf8 bytes array
// max   - length limit (mandatory);
module.exports.utf8border = (buf, max) => {

  max = max || buf.length;
  if (max > buf.length) { max = buf.length; }

  // go back from last position, until start of sequence found
  let pos = max - 1;
  while (pos >= 0 && (buf[pos] & 0xC0) === 0x80) { pos--; }

  // Very small and broken sequence,
  // return max, because we should return something anyway.
  if (pos < 0) { return max; }

  // If we came to start of buffer - that means buffer is too small,
  // return max too.
  if (pos === 0) { return max; }

  return (pos + _utf8len[buf[pos]] > max) ? pos : max;
};

},{}],33:[function(require,module,exports){
'use strict';

// Note: adler32 takes 12% for level 0 and 2% for level 6.
// It isn't worth it to make additional optimizations as in original.
// Small size is preferable.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32 = (adler, buf, len, pos) => {
  let s1 = (adler & 0xffff) |0,
      s2 = ((adler >>> 16) & 0xffff) |0,
      n = 0;

  while (len !== 0) {
    // Set limit ~ twice less than 5552, to keep
    // s2 in 31-bits, because we force signed ints.
    // in other case %= will fail.
    n = len > 2000 ? 2000 : len;
    len -= n;

    do {
      s1 = (s1 + buf[pos++]) |0;
      s2 = (s2 + s1) |0;
    } while (--n);

    s1 %= 65521;
    s2 %= 65521;
  }

  return (s1 | (s2 << 16)) |0;
};


module.exports = adler32;

},{}],34:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {

  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH:         0,
  Z_PARTIAL_FLUSH:    1,
  Z_SYNC_FLUSH:       2,
  Z_FULL_FLUSH:       3,
  Z_FINISH:           4,
  Z_BLOCK:            5,
  Z_TREES:            6,

  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK:               0,
  Z_STREAM_END:       1,
  Z_NEED_DICT:        2,
  Z_ERRNO:           -1,
  Z_STREAM_ERROR:    -2,
  Z_DATA_ERROR:      -3,
  Z_MEM_ERROR:       -4,
  Z_BUF_ERROR:       -5,
  //Z_VERSION_ERROR: -6,

  /* compression levels */
  Z_NO_COMPRESSION:         0,
  Z_BEST_SPEED:             1,
  Z_BEST_COMPRESSION:       9,
  Z_DEFAULT_COMPRESSION:   -1,


  Z_FILTERED:               1,
  Z_HUFFMAN_ONLY:           2,
  Z_RLE:                    3,
  Z_FIXED:                  4,
  Z_DEFAULT_STRATEGY:       0,

  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY:                 0,
  Z_TEXT:                   1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN:                2,

  /* The deflate compression method */
  Z_DEFLATED:               8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};

},{}],35:[function(require,module,exports){
'use strict';

// Note: we can't get significant speed boost here.
// So write code to minimize size - no pregenerated tables
// and array tools dependencies.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// Use ordinary array, since untyped makes no boost here
const makeTable = () => {
  let c, table = [];

  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[n] = c;
  }

  return table;
};

// Create table on load. Just 255 signed longs. Not a problem.
const crcTable = new Uint32Array(makeTable());


const crc32 = (crc, buf, len, pos) => {
  const t = crcTable;
  const end = pos + len;

  crc ^= -1;

  for (let i = pos; i < end; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  }

  return (crc ^ (-1)); // >>> 0;
};


module.exports = crc32;

},{}],36:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = require('./trees');
const adler32 = require('./adler32');
const crc32   = require('./crc32');
const msg     = require('./messages');

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_PARTIAL_FLUSH, Z_FULL_FLUSH, Z_FINISH, Z_BLOCK,
  Z_OK, Z_STREAM_END, Z_STREAM_ERROR, Z_DATA_ERROR, Z_BUF_ERROR,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, Z_FIXED, Z_DEFAULT_STRATEGY,
  Z_UNKNOWN,
  Z_DEFLATED
} = require('./constants');

/*============================================================================*/


const MAX_MEM_LEVEL = 9;
/* Maximum value for memLevel in deflateInit2 */
const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_MEM_LEVEL = 8;


const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */
const LITERALS      = 256;
/* number of literal bytes 0..255 */
const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */
const D_CODES       = 30;
/* number of distance codes */
const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */
const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */
const MAX_BITS  = 15;
/* All codes must not exceed MAX_BITS bits */

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MIN_LOOKAHEAD = (MAX_MATCH + MIN_MATCH + 1);

const PRESET_DICT = 0x20;

const INIT_STATE    =  42;    /* zlib header -> BUSY_STATE */
//#ifdef GZIP
const GZIP_STATE    =  57;    /* gzip header -> BUSY_STATE | EXTRA_STATE */
//#endif
const EXTRA_STATE   =  69;    /* gzip extra block -> NAME_STATE */
const NAME_STATE    =  73;    /* gzip file name -> COMMENT_STATE */
const COMMENT_STATE =  91;    /* gzip comment -> HCRC_STATE */
const HCRC_STATE    = 103;    /* gzip header CRC -> BUSY_STATE */
const BUSY_STATE    = 113;    /* deflate -> FINISH_STATE */
const FINISH_STATE  = 666;    /* stream complete */

const BS_NEED_MORE      = 1; /* block not completed, need more input or more output */
const BS_BLOCK_DONE     = 2; /* block flush performed */
const BS_FINISH_STARTED = 3; /* finish started, need only more output at next deflate */
const BS_FINISH_DONE    = 4; /* finish done, accept no more input or output */

const OS_CODE = 0x03; // Unix :) . Don't detect, use this default.

const err = (strm, errorCode) => {
  strm.msg = msg[errorCode];
  return errorCode;
};

const rank = (f) => {
  return ((f) * 2) - ((f) > 4 ? 9 : 0);
};

const zero = (buf) => {
  let len = buf.length; while (--len >= 0) { buf[len] = 0; }
};

/* ===========================================================================
 * Slide the hash table when sliding the window down (could be avoided with 32
 * bit values at the expense of memory usage). We slide even when level == 0 to
 * keep the hash table consistent if we switch back to level > 0 later.
 */
const slide_hash = (s) => {
  let n, m;
  let p;
  let wsize = s.w_size;

  n = s.hash_size;
  p = n;
  do {
    m = s.head[--p];
    s.head[p] = (m >= wsize ? m - wsize : 0);
  } while (--n);
  n = wsize;
//#ifndef FASTEST
  p = n;
  do {
    m = s.prev[--p];
    s.prev[p] = (m >= wsize ? m - wsize : 0);
    /* If n is not on any hash chain, prev[n] is garbage but
     * its value will never be used.
     */
  } while (--n);
//#endif
};

/* eslint-disable new-cap */
let HASH_ZLIB = (s, prev, data) => ((prev << s.hash_shift) ^ data) & s.hash_mask;
// This hash causes less collisions, https://github.com/nodeca/pako/issues/135
// But breaks binary compatibility
//let HASH_FAST = (s, prev, data) => ((prev << 8) + (prev >> 8) + (data << 4)) & s.hash_mask;
let HASH = HASH_ZLIB;


/* =========================================================================
 * Flush as much pending output as possible. All deflate() output, except for
 * some deflate_stored() output, goes through this function so some
 * applications may wish to modify it to avoid allocating a large
 * strm->next_out buffer and copying into it. (See also read_buf()).
 */
const flush_pending = (strm) => {
  const s = strm.state;

  //_tr_flush_bits(s);
  let len = s.pending;
  if (len > strm.avail_out) {
    len = strm.avail_out;
  }
  if (len === 0) { return; }

  strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
  strm.next_out  += len;
  s.pending_out  += len;
  strm.total_out += len;
  strm.avail_out -= len;
  s.pending      -= len;
  if (s.pending === 0) {
    s.pending_out = 0;
  }
};


const flush_block_only = (s, last) => {
  _tr_flush_block(s, (s.block_start >= 0 ? s.block_start : -1), s.strstart - s.block_start, last);
  s.block_start = s.strstart;
  flush_pending(s.strm);
};


const put_byte = (s, b) => {
  s.pending_buf[s.pending++] = b;
};


/* =========================================================================
 * Put a short in the pending buffer. The 16-bit value is put in MSB order.
 * IN assertion: the stream state is correct and there is enough room in
 * pending_buf.
 */
const putShortMSB = (s, b) => {

  //  put_byte(s, (Byte)(b >> 8));
//  put_byte(s, (Byte)(b & 0xff));
  s.pending_buf[s.pending++] = (b >>> 8) & 0xff;
  s.pending_buf[s.pending++] = b & 0xff;
};


/* ===========================================================================
 * Read a new buffer from the current input stream, update the adler32
 * and total number of bytes read.  All deflate() input goes through
 * this function so some applications may wish to modify it to avoid
 * allocating a large strm->input buffer and copying from it.
 * (See also flush_pending()).
 */
const read_buf = (strm, buf, start, size) => {

  let len = strm.avail_in;

  if (len > size) { len = size; }
  if (len === 0) { return 0; }

  strm.avail_in -= len;

  // zmemcpy(buf, strm->next_in, len);
  buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
  if (strm.state.wrap === 1) {
    strm.adler = adler32(strm.adler, buf, len, start);
  }

  else if (strm.state.wrap === 2) {
    strm.adler = crc32(strm.adler, buf, len, start);
  }

  strm.next_in += len;
  strm.total_in += len;

  return len;
};


/* ===========================================================================
 * Set match_start to the longest match starting at the given string and
 * return its length. Matches shorter or equal to prev_length are discarded,
 * in which case the result is equal to prev_length and match_start is
 * garbage.
 * IN assertions: cur_match is the head of the hash chain for the current
 *   string (strstart) and its distance is <= MAX_DIST, and prev_length >= 1
 * OUT assertion: the match length is not greater than s->lookahead.
 */
const longest_match = (s, cur_match) => {

  let chain_length = s.max_chain_length;      /* max hash chain length */
  let scan = s.strstart; /* current string */
  let match;                       /* matched string */
  let len;                           /* length of current match */
  let best_len = s.prev_length;              /* best match length so far */
  let nice_match = s.nice_match;             /* stop if match long enough */
  const limit = (s.strstart > (s.w_size - MIN_LOOKAHEAD)) ?
      s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0/*NIL*/;

  const _win = s.window; // shortcut

  const wmask = s.w_mask;
  const prev  = s.prev;

  /* Stop when cur_match becomes <= limit. To simplify the code,
   * we prevent matches with the string of window index 0.
   */

  const strend = s.strstart + MAX_MATCH;
  let scan_end1  = _win[scan + best_len - 1];
  let scan_end   = _win[scan + best_len];

  /* The code is optimized for HASH_BITS >= 8 and MAX_MATCH-2 multiple of 16.
   * It is easy to get rid of this optimization if necessary.
   */
  // Assert(s->hash_bits >= 8 && MAX_MATCH == 258, "Code too clever");

  /* Do not waste too much time if we already have a good match: */
  if (s.prev_length >= s.good_match) {
    chain_length >>= 2;
  }
  /* Do not look for matches beyond the end of the input. This is necessary
   * to make deflate deterministic.
   */
  if (nice_match > s.lookahead) { nice_match = s.lookahead; }

  // Assert((ulg)s->strstart <= s->window_size-MIN_LOOKAHEAD, "need lookahead");

  do {
    // Assert(cur_match < s->strstart, "no future");
    match = cur_match;

    /* Skip to next match if the match length cannot increase
     * or if the match length is less than 2.  Note that the checks below
     * for insufficient lookahead only occur occasionally for performance
     * reasons.  Therefore uninitialized memory will be accessed, and
     * conditional jumps will be made that depend on those values.
     * However the length of the match is limited to the lookahead, so
     * the output of deflate is not affected by the uninitialized values.
     */

    if (_win[match + best_len]     !== scan_end  ||
        _win[match + best_len - 1] !== scan_end1 ||
        _win[match]                !== _win[scan] ||
        _win[++match]              !== _win[scan + 1]) {
      continue;
    }

    /* The check at best_len-1 can be removed because it will be made
     * again later. (This heuristic is not always a win.)
     * It is not necessary to compare scan[2] and match[2] since they
     * are always equal when the other bytes match, given that
     * the hash keys are equal and that HASH_BITS >= 8.
     */
    scan += 2;
    match++;
    // Assert(*scan == *match, "match[2]?");

    /* We check for insufficient lookahead only every 8th comparison;
     * the 256th check will be made at strstart+258.
     */
    do {
      /*jshint noempty:false*/
    } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             scan < strend);

    // Assert(scan <= s->window+(unsigned)(s->window_size-1), "wild scan");

    len = MAX_MATCH - (strend - scan);
    scan = strend - MAX_MATCH;

    if (len > best_len) {
      s.match_start = cur_match;
      best_len = len;
      if (len >= nice_match) {
        break;
      }
      scan_end1  = _win[scan + best_len - 1];
      scan_end   = _win[scan + best_len];
    }
  } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);

  if (best_len <= s.lookahead) {
    return best_len;
  }
  return s.lookahead;
};


/* ===========================================================================
 * Fill the window when the lookahead becomes insufficient.
 * Updates strstart and lookahead.
 *
 * IN assertion: lookahead < MIN_LOOKAHEAD
 * OUT assertions: strstart <= window_size-MIN_LOOKAHEAD
 *    At least one byte has been read, or avail_in == 0; reads are
 *    performed for at least two bytes (required for the zip translate_eol
 *    option -- not supported here).
 */
const fill_window = (s) => {

  const _w_size = s.w_size;
  let n, more, str;

  //Assert(s->lookahead < MIN_LOOKAHEAD, "already enough lookahead");

  do {
    more = s.window_size - s.lookahead - s.strstart;

    // JS ints have 32 bit, block below not needed
    /* Deal with !@#$% 64K limit: */
    //if (sizeof(int) <= 2) {
    //    if (more == 0 && s->strstart == 0 && s->lookahead == 0) {
    //        more = wsize;
    //
    //  } else if (more == (unsigned)(-1)) {
    //        /* Very unlikely, but possible on 16 bit machine if
    //         * strstart == 0 && lookahead == 1 (input done a byte at time)
    //         */
    //        more--;
    //    }
    //}


    /* If the window is almost full and there is insufficient lookahead,
     * move the upper half to the lower one to make room in the upper half.
     */
    if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {

      s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
      s.match_start -= _w_size;
      s.strstart -= _w_size;
      /* we now have strstart >= MAX_DIST */
      s.block_start -= _w_size;
      if (s.insert > s.strstart) {
        s.insert = s.strstart;
      }
      slide_hash(s);
      more += _w_size;
    }
    if (s.strm.avail_in === 0) {
      break;
    }

    /* If there was no sliding:
     *    strstart <= WSIZE+MAX_DIST-1 && lookahead <= MIN_LOOKAHEAD - 1 &&
     *    more == window_size - lookahead - strstart
     * => more >= window_size - (MIN_LOOKAHEAD-1 + WSIZE + MAX_DIST-1)
     * => more >= window_size - 2*WSIZE + 2
     * In the BIG_MEM or MMAP case (not yet supported),
     *   window_size == input_size + MIN_LOOKAHEAD  &&
     *   strstart + s->lookahead <= input_size => more >= MIN_LOOKAHEAD.
     * Otherwise, window_size == 2*WSIZE so more >= 2.
     * If there was sliding, more >= WSIZE. So in all cases, more >= 2.
     */
    //Assert(more >= 2, "more < 2");
    n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
    s.lookahead += n;

    /* Initialize the hash value now that we have some input: */
    if (s.lookahead + s.insert >= MIN_MATCH) {
      str = s.strstart - s.insert;
      s.ins_h = s.window[str];

      /* UPDATE_HASH(s, s->ins_h, s->window[str + 1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
//#if MIN_MATCH != 3
//        Call update_hash() MIN_MATCH-3 more times
//#endif
      while (s.insert) {
        /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

        s.prev[str & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = str;
        str++;
        s.insert--;
        if (s.lookahead + s.insert < MIN_MATCH) {
          break;
        }
      }
    }
    /* If the whole input has less than MIN_MATCH bytes, ins_h is garbage,
     * but this is not important since only literal bytes will be emitted.
     */

  } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);

  /* If the WIN_INIT bytes after the end of the current data have never been
   * written, then zero those bytes in order to avoid memory check reports of
   * the use of uninitialized (or uninitialised as Julian writes) bytes by
   * the longest match routines.  Update the high water mark for the next
   * time through here.  WIN_INIT is set to MAX_MATCH since the longest match
   * routines allow scanning to strstart + MAX_MATCH, ignoring lookahead.
   */
//  if (s.high_water < s.window_size) {
//    const curr = s.strstart + s.lookahead;
//    let init = 0;
//
//    if (s.high_water < curr) {
//      /* Previous high water mark below current data -- zero WIN_INIT
//       * bytes or up to end of window, whichever is less.
//       */
//      init = s.window_size - curr;
//      if (init > WIN_INIT)
//        init = WIN_INIT;
//      zmemzero(s->window + curr, (unsigned)init);
//      s->high_water = curr + init;
//    }
//    else if (s->high_water < (ulg)curr + WIN_INIT) {
//      /* High water mark at or above current data, but below current data
//       * plus WIN_INIT -- zero out to current data plus WIN_INIT, or up
//       * to end of window, whichever is less.
//       */
//      init = (ulg)curr + WIN_INIT - s->high_water;
//      if (init > s->window_size - s->high_water)
//        init = s->window_size - s->high_water;
//      zmemzero(s->window + s->high_water, (unsigned)init);
//      s->high_water += init;
//    }
//  }
//
//  Assert((ulg)s->strstart <= s->window_size - MIN_LOOKAHEAD,
//    "not enough room for search");
};

/* ===========================================================================
 * Copy without compression as much as possible from the input stream, return
 * the current block state.
 *
 * In case deflateParams() is used to later switch to a non-zero compression
 * level, s->matches (otherwise unused when storing) keeps track of the number
 * of hash table slides to perform. If s->matches is 1, then one hash table
 * slide will be done when switching. If s->matches is 2, the maximum value
 * allowed here, then the hash table will be cleared, since two or more slides
 * is the same as a clear.
 *
 * deflate_stored() is written to minimize the number of times an input byte is
 * copied. It is most efficient with large input and output buffers, which
 * maximizes the opportunites to have a single copy from next_in to next_out.
 */
const deflate_stored = (s, flush) => {

  /* Smallest worthy block size when not flushing or finishing. By default
   * this is 32K. This can be as small as 507 bytes for memLevel == 1. For
   * large input and output buffers, the stored block size will be larger.
   */
  let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;

  /* Copy as many min_block or larger stored blocks directly to next_out as
   * possible. If flushing, copy the remaining available input to next_out as
   * stored blocks, if there is enough space.
   */
  let len, left, have, last = 0;
  let used = s.strm.avail_in;
  do {
    /* Set len to the maximum size block that we can copy directly with the
     * available input data and output space. Set left to how much of that
     * would be copied from what's left in the window.
     */
    len = 65535/* MAX_STORED */;     /* maximum deflate stored block length */
    have = (s.bi_valid + 42) >> 3;     /* number of header bytes */
    if (s.strm.avail_out < have) {         /* need room for header */
      break;
    }
      /* maximum stored block length that will fit in avail_out: */
    have = s.strm.avail_out - have;
    left = s.strstart - s.block_start;  /* bytes left in window */
    if (len > left + s.strm.avail_in) {
      len = left + s.strm.avail_in;   /* limit len to the input */
    }
    if (len > have) {
      len = have;             /* limit len to the output */
    }

    /* If the stored block would be less than min_block in length, or if
     * unable to copy all of the available input when flushing, then try
     * copying to the window and the pending buffer instead. Also don't
     * write an empty block when flushing -- deflate() does that.
     */
    if (len < min_block && ((len === 0 && flush !== Z_FINISH) ||
                        flush === Z_NO_FLUSH ||
                        len !== left + s.strm.avail_in)) {
      break;
    }

    /* Make a dummy stored block in pending to get the header bytes,
     * including any pending bits. This also updates the debugging counts.
     */
    last = flush === Z_FINISH && len === left + s.strm.avail_in ? 1 : 0;
    _tr_stored_block(s, 0, 0, last);

    /* Replace the lengths in the dummy stored block with len. */
    s.pending_buf[s.pending - 4] = len;
    s.pending_buf[s.pending - 3] = len >> 8;
    s.pending_buf[s.pending - 2] = ~len;
    s.pending_buf[s.pending - 1] = ~len >> 8;

    /* Write the stored block header bytes. */
    flush_pending(s.strm);

//#ifdef ZLIB_DEBUG
//    /* Update debugging counts for the data about to be copied. */
//    s->compressed_len += len << 3;
//    s->bits_sent += len << 3;
//#endif

    /* Copy uncompressed bytes from the window to next_out. */
    if (left) {
      if (left > len) {
        left = len;
      }
      //zmemcpy(s->strm->next_out, s->window + s->block_start, left);
      s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
      s.strm.next_out += left;
      s.strm.avail_out -= left;
      s.strm.total_out += left;
      s.block_start += left;
      len -= left;
    }

    /* Copy uncompressed bytes directly from next_in to next_out, updating
     * the check value.
     */
    if (len) {
      read_buf(s.strm, s.strm.output, s.strm.next_out, len);
      s.strm.next_out += len;
      s.strm.avail_out -= len;
      s.strm.total_out += len;
    }
  } while (last === 0);

  /* Update the sliding window with the last s->w_size bytes of the copied
   * data, or append all of the copied data to the existing window if less
   * than s->w_size bytes were copied. Also update the number of bytes to
   * insert in the hash tables, in the event that deflateParams() switches to
   * a non-zero compression level.
   */
  used -= s.strm.avail_in;    /* number of input bytes directly copied */
  if (used) {
    /* If any input was used, then no unused input remains in the window,
     * therefore s->block_start == s->strstart.
     */
    if (used >= s.w_size) {  /* supplant the previous history */
      s.matches = 2;     /* clear hash */
      //zmemcpy(s->window, s->strm->next_in - s->w_size, s->w_size);
      s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
      s.strstart = s.w_size;
      s.insert = s.strstart;
    }
    else {
      if (s.window_size - s.strstart <= used) {
        /* Slide the window down. */
        s.strstart -= s.w_size;
        //zmemcpy(s->window, s->window + s->w_size, s->strstart);
        s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
        if (s.matches < 2) {
          s.matches++;   /* add a pending slide_hash() */
        }
        if (s.insert > s.strstart) {
          s.insert = s.strstart;
        }
      }
      //zmemcpy(s->window + s->strstart, s->strm->next_in - used, used);
      s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
      s.strstart += used;
      s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
    }
    s.block_start = s.strstart;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }

  /* If the last block was written to next_out, then done. */
  if (last) {
    return BS_FINISH_DONE;
  }

  /* If flushing and all input has been consumed, then done. */
  if (flush !== Z_NO_FLUSH && flush !== Z_FINISH &&
    s.strm.avail_in === 0 && s.strstart === s.block_start) {
    return BS_BLOCK_DONE;
  }

  /* Fill the window with any remaining input. */
  have = s.window_size - s.strstart;
  if (s.strm.avail_in > have && s.block_start >= s.w_size) {
    /* Slide the window down. */
    s.block_start -= s.w_size;
    s.strstart -= s.w_size;
    //zmemcpy(s->window, s->window + s->w_size, s->strstart);
    s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
    if (s.matches < 2) {
      s.matches++;       /* add a pending slide_hash() */
    }
    have += s.w_size;      /* more space now */
    if (s.insert > s.strstart) {
      s.insert = s.strstart;
    }
  }
  if (have > s.strm.avail_in) {
    have = s.strm.avail_in;
  }
  if (have) {
    read_buf(s.strm, s.window, s.strstart, have);
    s.strstart += have;
    s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }

  /* There was not enough avail_out to write a complete worthy or flushed
   * stored block to next_out. Write a stored block to pending instead, if we
   * have enough input for a worthy block, or if flushing and there is enough
   * room for the remaining input as a stored block in the pending buffer.
   */
  have = (s.bi_valid + 42) >> 3;     /* number of header bytes */
    /* maximum stored block length that will fit in pending: */
  have = s.pending_buf_size - have > 65535/* MAX_STORED */ ? 65535/* MAX_STORED */ : s.pending_buf_size - have;
  min_block = have > s.w_size ? s.w_size : have;
  left = s.strstart - s.block_start;
  if (left >= min_block ||
     ((left || flush === Z_FINISH) && flush !== Z_NO_FLUSH &&
     s.strm.avail_in === 0 && left <= have)) {
    len = left > have ? have : left;
    last = flush === Z_FINISH && s.strm.avail_in === 0 &&
         len === left ? 1 : 0;
    _tr_stored_block(s, s.block_start, len, last);
    s.block_start += len;
    flush_pending(s.strm);
  }

  /* We've done all we can with the available input and output. */
  return last ? BS_FINISH_STARTED : BS_NEED_MORE;
};


/* ===========================================================================
 * Compress as much as possible from the input stream, return the current
 * block state.
 * This function does not perform lazy evaluation of matches and inserts
 * new strings in the dictionary only for unmatched strings or for short
 * matches. It is used only for the fast compression options.
 */
const deflate_fast = (s, flush) => {

  let hash_head;        /* head of the hash chain */
  let bflush;           /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break; /* flush the current block */
      }
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     * At this point we have always match_length < MIN_MATCH
     */
    if (hash_head !== 0/*NIL*/ && ((s.strstart - hash_head) <= (s.w_size - MIN_LOOKAHEAD))) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */
    }
    if (s.match_length >= MIN_MATCH) {
      // check_match(s, s.strstart, s.match_start, s.match_length); // for debug only

      /*** _tr_tally_dist(s, s.strstart - s.match_start,
                     s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;

      /* Insert new strings in the hash table only if the match length
       * is not too large. This saves time but degrades compression.
       */
      if (s.match_length <= s.max_lazy_match/*max_insert_length*/ && s.lookahead >= MIN_MATCH) {
        s.match_length--; /* string at strstart already in table */
        do {
          s.strstart++;
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
          /* strstart never exceeds WSIZE-MAX_MATCH, so there are
           * always MIN_MATCH bytes ahead.
           */
        } while (--s.match_length !== 0);
        s.strstart++;
      } else
      {
        s.strstart += s.match_length;
        s.match_length = 0;
        s.ins_h = s.window[s.strstart];
        /* UPDATE_HASH(s, s.ins_h, s.window[s.strstart+1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);

//#if MIN_MATCH != 3
//                Call UPDATE_HASH() MIN_MATCH-3 more times
//#endif
        /* If lookahead < MIN_MATCH, ins_h is garbage, but it does not
         * matter since it will be recomputed at next deflate call.
         */
      }
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s.window[s.strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = ((s.strstart < (MIN_MATCH - 1)) ? s.strstart : MIN_MATCH - 1);
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * Same as above, but achieves better compression. We use a lazy
 * evaluation for matches: a match is finally adopted only if there is
 * no better match at the next window position.
 */
const deflate_slow = (s, flush) => {

  let hash_head;          /* head of hash chain */
  let bflush;              /* set if current block must be flushed */

  let max_insert;

  /* Process the input block. */
  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     */
    s.prev_length = s.match_length;
    s.prev_match = s.match_start;
    s.match_length = MIN_MATCH - 1;

    if (hash_head !== 0/*NIL*/ && s.prev_length < s.max_lazy_match &&
        s.strstart - hash_head <= (s.w_size - MIN_LOOKAHEAD)/*MAX_DIST(s)*/) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */

      if (s.match_length <= 5 &&
         (s.strategy === Z_FILTERED || (s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096/*TOO_FAR*/))) {

        /* If prev_match is also MIN_MATCH, match_start is garbage
         * but we will ignore the current match anyway.
         */
        s.match_length = MIN_MATCH - 1;
      }
    }
    /* If there was a match at the previous step and the current
     * match is not better, output the previous match:
     */
    if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
      max_insert = s.strstart + s.lookahead - MIN_MATCH;
      /* Do not insert strings in hash table beyond this. */

      //check_match(s, s.strstart-1, s.prev_match, s.prev_length);

      /***_tr_tally_dist(s, s.strstart - 1 - s.prev_match,
                     s.prev_length - MIN_MATCH, bflush);***/
      bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
      /* Insert in hash table all strings up to the end of the match.
       * strstart-1 and strstart are already inserted. If there is not
       * enough lookahead, the last two strings are not inserted in
       * the hash table.
       */
      s.lookahead -= s.prev_length - 1;
      s.prev_length -= 2;
      do {
        if (++s.strstart <= max_insert) {
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
        }
      } while (--s.prev_length !== 0);
      s.match_available = 0;
      s.match_length = MIN_MATCH - 1;
      s.strstart++;

      if (bflush) {
        /*** FLUSH_BLOCK(s, 0); ***/
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
        /***/
      }

    } else if (s.match_available) {
      /* If there was no match at the previous position, output a
       * single literal. If there was a match but the current match
       * is longer, truncate the previous match to a single literal.
       */
      //Tracevv((stderr,"%c", s->window[s->strstart-1]));
      /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

      if (bflush) {
        /*** FLUSH_BLOCK_ONLY(s, 0) ***/
        flush_block_only(s, false);
        /***/
      }
      s.strstart++;
      s.lookahead--;
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    } else {
      /* There is no previous match to compare with, wait for
       * the next step to decide.
       */
      s.match_available = 1;
      s.strstart++;
      s.lookahead--;
    }
  }
  //Assert (flush != Z_NO_FLUSH, "no flush?");
  if (s.match_available) {
    //Tracevv((stderr,"%c", s->window[s->strstart-1]));
    /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

    s.match_available = 0;
  }
  s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }

  return BS_BLOCK_DONE;
};


/* ===========================================================================
 * For Z_RLE, simply look for runs of bytes, generate matches only of distance
 * one.  Do not maintain a hash table.  (It will be regenerated if this run of
 * deflate switches away from Z_RLE.)
 */
const deflate_rle = (s, flush) => {

  let bflush;            /* set if current block must be flushed */
  let prev;              /* byte at distance one to match */
  let scan, strend;      /* scan goes up to strend for length of run */

  const _win = s.window;

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the longest run, plus one for the unrolled loop.
     */
    if (s.lookahead <= MAX_MATCH) {
      fill_window(s);
      if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* See how many times the previous byte repeats */
    s.match_length = 0;
    if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
      scan = s.strstart - 1;
      prev = _win[scan];
      if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
        strend = s.strstart + MAX_MATCH;
        do {
          /*jshint noempty:false*/
        } while (prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 scan < strend);
        s.match_length = MAX_MATCH - (strend - scan);
        if (s.match_length > s.lookahead) {
          s.match_length = s.lookahead;
        }
      }
      //Assert(scan <= s->window+(uInt)(s->window_size-1), "wild scan");
    }

    /* Emit match if have run of MIN_MATCH or longer, else emit literal */
    if (s.match_length >= MIN_MATCH) {
      //check_match(s, s.strstart, s.strstart - 1, s.match_length);

      /*** _tr_tally_dist(s, 1, s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;
      s.strstart += s.match_length;
      s.match_length = 0;
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s->window[s->strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * For Z_HUFFMAN_ONLY, do not look for matches.  Do not maintain a hash table.
 * (It will be regenerated if this run of deflate switches away from Huffman.)
 */
const deflate_huff = (s, flush) => {

  let bflush;             /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we have a literal to write. */
    if (s.lookahead === 0) {
      fill_window(s);
      if (s.lookahead === 0) {
        if (flush === Z_NO_FLUSH) {
          return BS_NEED_MORE;
        }
        break;      /* flush the current block */
      }
    }

    /* Output a literal byte */
    s.match_length = 0;
    //Tracevv((stderr,"%c", s->window[s->strstart]));
    /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart]);
    s.lookahead--;
    s.strstart++;
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* Values for max_lazy_match, good_match and max_chain_length, depending on
 * the desired pack level (0..9). The values given below have been tuned to
 * exclude worst case performance for pathological files. Better values may be
 * found for specific files.
 */
function Config(good_length, max_lazy, nice_length, max_chain, func) {

  this.good_length = good_length;
  this.max_lazy = max_lazy;
  this.nice_length = nice_length;
  this.max_chain = max_chain;
  this.func = func;
}

const configuration_table = [
  /*      good lazy nice chain */
  new Config(0, 0, 0, 0, deflate_stored),          /* 0 store only */
  new Config(4, 4, 8, 4, deflate_fast),            /* 1 max speed, no lazy matches */
  new Config(4, 5, 16, 8, deflate_fast),           /* 2 */
  new Config(4, 6, 32, 32, deflate_fast),          /* 3 */

  new Config(4, 4, 16, 16, deflate_slow),          /* 4 lazy matches */
  new Config(8, 16, 32, 32, deflate_slow),         /* 5 */
  new Config(8, 16, 128, 128, deflate_slow),       /* 6 */
  new Config(8, 32, 128, 256, deflate_slow),       /* 7 */
  new Config(32, 128, 258, 1024, deflate_slow),    /* 8 */
  new Config(32, 258, 258, 4096, deflate_slow)     /* 9 max compression */
];


/* ===========================================================================
 * Initialize the "longest match" routines for a new zlib stream
 */
const lm_init = (s) => {

  s.window_size = 2 * s.w_size;

  /*** CLEAR_HASH(s); ***/
  zero(s.head); // Fill with NIL (= 0);

  /* Set the default configuration parameters:
   */
  s.max_lazy_match = configuration_table[s.level].max_lazy;
  s.good_match = configuration_table[s.level].good_length;
  s.nice_match = configuration_table[s.level].nice_length;
  s.max_chain_length = configuration_table[s.level].max_chain;

  s.strstart = 0;
  s.block_start = 0;
  s.lookahead = 0;
  s.insert = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  s.ins_h = 0;
};


function DeflateState() {
  this.strm = null;            /* pointer back to this zlib stream */
  this.status = 0;            /* as the name implies */
  this.pending_buf = null;      /* output still pending */
  this.pending_buf_size = 0;  /* size of pending_buf */
  this.pending_out = 0;       /* next pending byte to output to the stream */
  this.pending = 0;           /* nb of bytes in the pending buffer */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
  this.gzhead = null;         /* gzip header information to write */
  this.gzindex = 0;           /* where in extra, name, or comment */
  this.method = Z_DEFLATED; /* can only be DEFLATED */
  this.last_flush = -1;   /* value of flush param for previous deflate call */

  this.w_size = 0;  /* LZ77 window size (32K by default) */
  this.w_bits = 0;  /* log2(w_size)  (8..16) */
  this.w_mask = 0;  /* w_size - 1 */

  this.window = null;
  /* Sliding window. Input bytes are read into the second half of the window,
   * and move to the first half later to keep a dictionary of at least wSize
   * bytes. With this organization, matches are limited to a distance of
   * wSize-MAX_MATCH bytes, but this ensures that IO is always
   * performed with a length multiple of the block size.
   */

  this.window_size = 0;
  /* Actual size of window: 2*wSize, except when the user input buffer
   * is directly used as sliding window.
   */

  this.prev = null;
  /* Link to older string with same hash index. To limit the size of this
   * array to 64K, this link is maintained only for the last 32K strings.
   * An index in this array is thus a window index modulo 32K.
   */

  this.head = null;   /* Heads of the hash chains or NIL. */

  this.ins_h = 0;       /* hash index of string to be inserted */
  this.hash_size = 0;   /* number of elements in hash table */
  this.hash_bits = 0;   /* log2(hash_size) */
  this.hash_mask = 0;   /* hash_size-1 */

  this.hash_shift = 0;
  /* Number of bits by which ins_h must be shifted at each input
   * step. It must be such that after MIN_MATCH steps, the oldest
   * byte no longer takes part in the hash key, that is:
   *   hash_shift * MIN_MATCH >= hash_bits
   */

  this.block_start = 0;
  /* Window position at the beginning of the current output block. Gets
   * negative when the window is moved backwards.
   */

  this.match_length = 0;      /* length of best match */
  this.prev_match = 0;        /* previous match */
  this.match_available = 0;   /* set if previous match exists */
  this.strstart = 0;          /* start of string to insert */
  this.match_start = 0;       /* start of matching string */
  this.lookahead = 0;         /* number of valid bytes ahead in window */

  this.prev_length = 0;
  /* Length of the best match at previous step. Matches not greater than this
   * are discarded. This is used in the lazy match evaluation.
   */

  this.max_chain_length = 0;
  /* To speed up deflation, hash chains are never searched beyond this
   * length.  A higher limit improves compression ratio but degrades the
   * speed.
   */

  this.max_lazy_match = 0;
  /* Attempt to find a better match only when the current match is strictly
   * smaller than this value. This mechanism is used only for compression
   * levels >= 4.
   */
  // That's alias to max_lazy_match, don't use directly
  //this.max_insert_length = 0;
  /* Insert new strings in the hash table only if the match length is not
   * greater than this length. This saves time but degrades compression.
   * max_insert_length is used only for compression levels <= 3.
   */

  this.level = 0;     /* compression level (1..9) */
  this.strategy = 0;  /* favor or force Huffman coding*/

  this.good_match = 0;
  /* Use a faster search when the previous match is longer than this */

  this.nice_match = 0; /* Stop searching when current match exceeds this */

              /* used by trees.c: */

  /* Didn't use ct_data typedef below to suppress compiler warning */

  // struct ct_data_s dyn_ltree[HEAP_SIZE];   /* literal and length tree */
  // struct ct_data_s dyn_dtree[2*D_CODES+1]; /* distance tree */
  // struct ct_data_s bl_tree[2*BL_CODES+1];  /* Huffman tree for bit lengths */

  // Use flat array of DOUBLE size, with interleaved fata,
  // because JS does not support effective
  this.dyn_ltree  = new Uint16Array(HEAP_SIZE * 2);
  this.dyn_dtree  = new Uint16Array((2 * D_CODES + 1) * 2);
  this.bl_tree    = new Uint16Array((2 * BL_CODES + 1) * 2);
  zero(this.dyn_ltree);
  zero(this.dyn_dtree);
  zero(this.bl_tree);

  this.l_desc   = null;         /* desc. for literal tree */
  this.d_desc   = null;         /* desc. for distance tree */
  this.bl_desc  = null;         /* desc. for bit length tree */

  //ush bl_count[MAX_BITS+1];
  this.bl_count = new Uint16Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  //int heap[2*L_CODES+1];      /* heap used to build the Huffman trees */
  this.heap = new Uint16Array(2 * L_CODES + 1);  /* heap used to build the Huffman trees */
  zero(this.heap);

  this.heap_len = 0;               /* number of elements in the heap */
  this.heap_max = 0;               /* element of largest frequency */
  /* The sons of heap[n] are heap[2*n] and heap[2*n+1]. heap[0] is not used.
   * The same heap array is used to build all trees.
   */

  this.depth = new Uint16Array(2 * L_CODES + 1); //uch depth[2*L_CODES+1];
  zero(this.depth);
  /* Depth of each subtree used as tie breaker for trees of equal frequency
   */

  this.sym_buf = 0;        /* buffer for distances and literals/lengths */

  this.lit_bufsize = 0;
  /* Size of match buffer for literals/lengths.  There are 4 reasons for
   * limiting lit_bufsize to 64K:
   *   - frequencies can be kept in 16 bit counters
   *   - if compression is not successful for the first block, all input
   *     data is still in the window so we can still emit a stored block even
   *     when input comes from standard input.  (This can also be done for
   *     all blocks if lit_bufsize is not greater than 32K.)
   *   - if compression is not successful for a file smaller than 64K, we can
   *     even emit a stored file instead of a stored block (saving 5 bytes).
   *     This is applicable only for zip (not gzip or zlib).
   *   - creating new Huffman trees less frequently may not provide fast
   *     adaptation to changes in the input data statistics. (Take for
   *     example a binary file with poorly compressible code followed by
   *     a highly compressible string table.) Smaller buffer sizes give
   *     fast adaptation but have of course the overhead of transmitting
   *     trees more frequently.
   *   - I can't count above 4
   */

  this.sym_next = 0;      /* running index in sym_buf */
  this.sym_end = 0;       /* symbol table full when sym_next reaches this */

  this.opt_len = 0;       /* bit length of current block with optimal trees */
  this.static_len = 0;    /* bit length of current block with static trees */
  this.matches = 0;       /* number of string matches in current block */
  this.insert = 0;        /* bytes at end of window left to insert */


  this.bi_buf = 0;
  /* Output buffer. bits are inserted starting at the bottom (least
   * significant bits).
   */
  this.bi_valid = 0;
  /* Number of valid bits in bi_buf.  All bits above the last valid bit
   * are always zero.
   */

  // Used for window memory init. We safely ignore it for JS. That makes
  // sense only for pointers and memory check tools.
  //this.high_water = 0;
  /* High water mark offset in window for initialized bytes -- bytes above
   * this are set to zero in order to avoid memory check warnings when
   * longest match routines access bytes past the input.  This is then
   * updated to the new high water mark.
   */
}


/* =========================================================================
 * Check for a valid deflate stream state. Return 0 if ok, 1 if not.
 */
const deflateStateCheck = (strm) => {

  if (!strm) {
    return 1;
  }
  const s = strm.state;
  if (!s || s.strm !== strm || (s.status !== INIT_STATE &&
//#ifdef GZIP
                                s.status !== GZIP_STATE &&
//#endif
                                s.status !== EXTRA_STATE &&
                                s.status !== NAME_STATE &&
                                s.status !== COMMENT_STATE &&
                                s.status !== HCRC_STATE &&
                                s.status !== BUSY_STATE &&
                                s.status !== FINISH_STATE)) {
    return 1;
  }
  return 0;
};


const deflateResetKeep = (strm) => {

  if (deflateStateCheck(strm)) {
    return err(strm, Z_STREAM_ERROR);
  }

  strm.total_in = strm.total_out = 0;
  strm.data_type = Z_UNKNOWN;

  const s = strm.state;
  s.pending = 0;
  s.pending_out = 0;

  if (s.wrap < 0) {
    s.wrap = -s.wrap;
    /* was made negative by deflate(..., Z_FINISH); */
  }
  s.status =
//#ifdef GZIP
    s.wrap === 2 ? GZIP_STATE :
//#endif
    s.wrap ? INIT_STATE : BUSY_STATE;
  strm.adler = (s.wrap === 2) ?
    0  // crc32(0, Z_NULL, 0)
  :
    1; // adler32(0, Z_NULL, 0)
  s.last_flush = -2;
  _tr_init(s);
  return Z_OK;
};


const deflateReset = (strm) => {

  const ret = deflateResetKeep(strm);
  if (ret === Z_OK) {
    lm_init(strm.state);
  }
  return ret;
};


const deflateSetHeader = (strm, head) => {

  if (deflateStateCheck(strm) || strm.state.wrap !== 2) {
    return Z_STREAM_ERROR;
  }
  strm.state.gzhead = head;
  return Z_OK;
};


const deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {

  if (!strm) { // === Z_NULL
    return Z_STREAM_ERROR;
  }
  let wrap = 1;

  if (level === Z_DEFAULT_COMPRESSION) {
    level = 6;
  }

  if (windowBits < 0) { /* suppress zlib wrapper */
    wrap = 0;
    windowBits = -windowBits;
  }

  else if (windowBits > 15) {
    wrap = 2;           /* write gzip wrapper instead */
    windowBits -= 16;
  }


  if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED ||
    windowBits < 8 || windowBits > 15 || level < 0 || level > 9 ||
    strategy < 0 || strategy > Z_FIXED || (windowBits === 8 && wrap !== 1)) {
    return err(strm, Z_STREAM_ERROR);
  }


  if (windowBits === 8) {
    windowBits = 9;
  }
  /* until 256-byte window bug fixed */

  const s = new DeflateState();

  strm.state = s;
  s.strm = strm;
  s.status = INIT_STATE;     /* to pass state test in deflateReset() */

  s.wrap = wrap;
  s.gzhead = null;
  s.w_bits = windowBits;
  s.w_size = 1 << s.w_bits;
  s.w_mask = s.w_size - 1;

  s.hash_bits = memLevel + 7;
  s.hash_size = 1 << s.hash_bits;
  s.hash_mask = s.hash_size - 1;
  s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);

  s.window = new Uint8Array(s.w_size * 2);
  s.head = new Uint16Array(s.hash_size);
  s.prev = new Uint16Array(s.w_size);

  // Don't need mem init magic for JS.
  //s.high_water = 0;  /* nothing written to s->window yet */

  s.lit_bufsize = 1 << (memLevel + 6); /* 16K elements by default */

  /* We overlay pending_buf and sym_buf. This works since the average size
   * for length/distance pairs over any compressed block is assured to be 31
   * bits or less.
   *
   * Analysis: The longest fixed codes are a length code of 8 bits plus 5
   * extra bits, for lengths 131 to 257. The longest fixed distance codes are
   * 5 bits plus 13 extra bits, for distances 16385 to 32768. The longest
   * possible fixed-codes length/distance pair is then 31 bits total.
   *
   * sym_buf starts one-fourth of the way into pending_buf. So there are
   * three bytes in sym_buf for every four bytes in pending_buf. Each symbol
   * in sym_buf is three bytes -- two for the distance and one for the
   * literal/length. As each symbol is consumed, the pointer to the next
   * sym_buf value to read moves forward three bytes. From that symbol, up to
   * 31 bits are written to pending_buf. The closest the written pending_buf
   * bits gets to the next sym_buf symbol to read is just before the last
   * code is written. At that time, 31*(n-2) bits have been written, just
   * after 24*(n-2) bits have been consumed from sym_buf. sym_buf starts at
   * 8*n bits into pending_buf. (Note that the symbol buffer fills when n-1
   * symbols are written.) The closest the writing gets to what is unread is
   * then n+14 bits. Here n is lit_bufsize, which is 16384 by default, and
   * can range from 128 to 32768.
   *
   * Therefore, at a minimum, there are 142 bits of space between what is
   * written and what is read in the overlain buffers, so the symbols cannot
   * be overwritten by the compressed data. That space is actually 139 bits,
   * due to the three-bit fixed-code block header.
   *
   * That covers the case where either Z_FIXED is specified, forcing fixed
   * codes, or when the use of fixed codes is chosen, because that choice
   * results in a smaller compressed block than dynamic codes. That latter
   * condition then assures that the above analysis also covers all dynamic
   * blocks. A dynamic-code block will only be chosen to be emitted if it has
   * fewer bits than a fixed-code block would for the same set of symbols.
   * Therefore its average symbol length is assured to be less than 31. So
   * the compressed data for a dynamic block also cannot overwrite the
   * symbols from which it is being constructed.
   */

  s.pending_buf_size = s.lit_bufsize * 4;
  s.pending_buf = new Uint8Array(s.pending_buf_size);

  // It is offset from `s.pending_buf` (size is `s.lit_bufsize * 2`)
  //s->sym_buf = s->pending_buf + s->lit_bufsize;
  s.sym_buf = s.lit_bufsize;

  //s->sym_end = (s->lit_bufsize - 1) * 3;
  s.sym_end = (s.lit_bufsize - 1) * 3;
  /* We avoid equality with lit_bufsize*3 because of wraparound at 64K
   * on 16 bit machines and because stored blocks are restricted to
   * 64K-1 bytes.
   */

  s.level = level;
  s.strategy = strategy;
  s.method = method;

  return deflateReset(strm);
};

const deflateInit = (strm, level) => {

  return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
};


/* ========================================================================= */
const deflate = (strm, flush) => {

  if (deflateStateCheck(strm) || flush > Z_BLOCK || flush < 0) {
    return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
  }

  const s = strm.state;

  if (!strm.output ||
      (strm.avail_in !== 0 && !strm.input) ||
      (s.status === FINISH_STATE && flush !== Z_FINISH)) {
    return err(strm, (strm.avail_out === 0) ? Z_BUF_ERROR : Z_STREAM_ERROR);
  }

  const old_flush = s.last_flush;
  s.last_flush = flush;

  /* Flush as much pending output as possible */
  if (s.pending !== 0) {
    flush_pending(strm);
    if (strm.avail_out === 0) {
      /* Since avail_out is 0, deflate will be called again with
       * more output space, but possibly with both pending and
       * avail_in equal to zero. There won't be anything to do,
       * but this is not an error situation so make sure we
       * return OK instead of BUF_ERROR at next call of deflate:
       */
      s.last_flush = -1;
      return Z_OK;
    }

    /* Make sure there is something to do and avoid duplicate consecutive
     * flushes. For repeated and useless calls with Z_FINISH, we keep
     * returning Z_STREAM_END instead of Z_BUF_ERROR.
     */
  } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) &&
    flush !== Z_FINISH) {
    return err(strm, Z_BUF_ERROR);
  }

  /* User must not provide more input after the first FINISH: */
  if (s.status === FINISH_STATE && strm.avail_in !== 0) {
    return err(strm, Z_BUF_ERROR);
  }

  /* Write the header */
  if (s.status === INIT_STATE && s.wrap === 0) {
    s.status = BUSY_STATE;
  }
  if (s.status === INIT_STATE) {
    /* zlib header */
    let header = (Z_DEFLATED + ((s.w_bits - 8) << 4)) << 8;
    let level_flags = -1;

    if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
      level_flags = 0;
    } else if (s.level < 6) {
      level_flags = 1;
    } else if (s.level === 6) {
      level_flags = 2;
    } else {
      level_flags = 3;
    }
    header |= (level_flags << 6);
    if (s.strstart !== 0) { header |= PRESET_DICT; }
    header += 31 - (header % 31);

    putShortMSB(s, header);

    /* Save the adler32 of the preset dictionary: */
    if (s.strstart !== 0) {
      putShortMSB(s, strm.adler >>> 16);
      putShortMSB(s, strm.adler & 0xffff);
    }
    strm.adler = 1; // adler32(0L, Z_NULL, 0);
    s.status = BUSY_STATE;

    /* Compression must start with an empty pending buffer */
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK;
    }
  }
//#ifdef GZIP
  if (s.status === GZIP_STATE) {
    /* gzip header */
    strm.adler = 0;  //crc32(0L, Z_NULL, 0);
    put_byte(s, 31);
    put_byte(s, 139);
    put_byte(s, 8);
    if (!s.gzhead) { // s->gzhead == Z_NULL
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, s.level === 9 ? 2 :
                  (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                   4 : 0));
      put_byte(s, OS_CODE);
      s.status = BUSY_STATE;

      /* Compression must start with an empty pending buffer */
      flush_pending(strm);
      if (s.pending !== 0) {
        s.last_flush = -1;
        return Z_OK;
      }
    }
    else {
      put_byte(s, (s.gzhead.text ? 1 : 0) +
                  (s.gzhead.hcrc ? 2 : 0) +
                  (!s.gzhead.extra ? 0 : 4) +
                  (!s.gzhead.name ? 0 : 8) +
                  (!s.gzhead.comment ? 0 : 16)
      );
      put_byte(s, s.gzhead.time & 0xff);
      put_byte(s, (s.gzhead.time >> 8) & 0xff);
      put_byte(s, (s.gzhead.time >> 16) & 0xff);
      put_byte(s, (s.gzhead.time >> 24) & 0xff);
      put_byte(s, s.level === 9 ? 2 :
                  (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                   4 : 0));
      put_byte(s, s.gzhead.os & 0xff);
      if (s.gzhead.extra && s.gzhead.extra.length) {
        put_byte(s, s.gzhead.extra.length & 0xff);
        put_byte(s, (s.gzhead.extra.length >> 8) & 0xff);
      }
      if (s.gzhead.hcrc) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
      }
      s.gzindex = 0;
      s.status = EXTRA_STATE;
    }
  }
  if (s.status === EXTRA_STATE) {
    if (s.gzhead.extra/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let left = (s.gzhead.extra.length & 0xffff) - s.gzindex;
      while (s.pending + left > s.pending_buf_size) {
        let copy = s.pending_buf_size - s.pending;
        // zmemcpy(s.pending_buf + s.pending,
        //    s.gzhead.extra + s.gzindex, copy);
        s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
        s.pending = s.pending_buf_size;
        //--- HCRC_UPDATE(beg) ---//
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
        //---//
        s.gzindex += copy;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
        beg = 0;
        left -= copy;
      }
      // JS specific: s.gzhead.extra may be TypedArray or Array for backward compatibility
      //              TypedArray.slice and TypedArray.from don't exist in IE10-IE11
      let gzhead_extra = new Uint8Array(s.gzhead.extra);
      // zmemcpy(s->pending_buf + s->pending,
      //     s->gzhead->extra + s->gzindex, left);
      s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
      s.pending += left;
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
      s.gzindex = 0;
    }
    s.status = NAME_STATE;
  }
  if (s.status === NAME_STATE) {
    if (s.gzhead.name/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          //--- HCRC_UPDATE(beg) ---//
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          //---//
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK;
          }
          beg = 0;
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.name.length) {
          val = s.gzhead.name.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
      s.gzindex = 0;
    }
    s.status = COMMENT_STATE;
  }
  if (s.status === COMMENT_STATE) {
    if (s.gzhead.comment/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          //--- HCRC_UPDATE(beg) ---//
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          //---//
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK;
          }
          beg = 0;
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.comment.length) {
          val = s.gzhead.comment.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
    }
    s.status = HCRC_STATE;
  }
  if (s.status === HCRC_STATE) {
    if (s.gzhead.hcrc) {
      if (s.pending + 2 > s.pending_buf_size) {
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
      }
      put_byte(s, strm.adler & 0xff);
      put_byte(s, (strm.adler >> 8) & 0xff);
      strm.adler = 0; //crc32(0L, Z_NULL, 0);
    }
    s.status = BUSY_STATE;

    /* Compression must start with an empty pending buffer */
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK;
    }
  }
//#endif

  /* Start a new block or continue the current one.
   */
  if (strm.avail_in !== 0 || s.lookahead !== 0 ||
    (flush !== Z_NO_FLUSH && s.status !== FINISH_STATE)) {
    let bstate = s.level === 0 ? deflate_stored(s, flush) :
                 s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) :
                 s.strategy === Z_RLE ? deflate_rle(s, flush) :
                 configuration_table[s.level].func(s, flush);

    if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
      s.status = FINISH_STATE;
    }
    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
      if (strm.avail_out === 0) {
        s.last_flush = -1;
        /* avoid BUF_ERROR next call, see above */
      }
      return Z_OK;
      /* If flush != Z_NO_FLUSH && avail_out == 0, the next call
       * of deflate should use the same flush parameter to make sure
       * that the flush is complete. So we don't have to output an
       * empty block here, this will be done at next call. This also
       * ensures that for a very small output buffer, we emit at most
       * one empty block.
       */
    }
    if (bstate === BS_BLOCK_DONE) {
      if (flush === Z_PARTIAL_FLUSH) {
        _tr_align(s);
      }
      else if (flush !== Z_BLOCK) { /* FULL_FLUSH or SYNC_FLUSH */

        _tr_stored_block(s, 0, 0, false);
        /* For a full flush, this empty block will be recognized
         * as a special marker by inflate_sync().
         */
        if (flush === Z_FULL_FLUSH) {
          /*** CLEAR_HASH(s); ***/             /* forget history */
          zero(s.head); // Fill with NIL (= 0);

          if (s.lookahead === 0) {
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }
        }
      }
      flush_pending(strm);
      if (strm.avail_out === 0) {
        s.last_flush = -1; /* avoid BUF_ERROR at next call, see above */
        return Z_OK;
      }
    }
  }

  if (flush !== Z_FINISH) { return Z_OK; }
  if (s.wrap <= 0) { return Z_STREAM_END; }

  /* Write the trailer */
  if (s.wrap === 2) {
    put_byte(s, strm.adler & 0xff);
    put_byte(s, (strm.adler >> 8) & 0xff);
    put_byte(s, (strm.adler >> 16) & 0xff);
    put_byte(s, (strm.adler >> 24) & 0xff);
    put_byte(s, strm.total_in & 0xff);
    put_byte(s, (strm.total_in >> 8) & 0xff);
    put_byte(s, (strm.total_in >> 16) & 0xff);
    put_byte(s, (strm.total_in >> 24) & 0xff);
  }
  else
  {
    putShortMSB(s, strm.adler >>> 16);
    putShortMSB(s, strm.adler & 0xffff);
  }

  flush_pending(strm);
  /* If avail_out is zero, the application will call deflate again
   * to flush the rest.
   */
  if (s.wrap > 0) { s.wrap = -s.wrap; }
  /* write the trailer only once! */
  return s.pending !== 0 ? Z_OK : Z_STREAM_END;
};


const deflateEnd = (strm) => {

  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  const status = strm.state.status;

  strm.state = null;

  return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
};


/* =========================================================================
 * Initializes the compression dictionary from the given byte
 * sequence without producing any compressed output.
 */
const deflateSetDictionary = (strm, dictionary) => {

  let dictLength = dictionary.length;

  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  const s = strm.state;
  const wrap = s.wrap;

  if (wrap === 2 || (wrap === 1 && s.status !== INIT_STATE) || s.lookahead) {
    return Z_STREAM_ERROR;
  }

  /* when using zlib wrappers, compute Adler-32 for provided dictionary */
  if (wrap === 1) {
    /* adler32(strm->adler, dictionary, dictLength); */
    strm.adler = adler32(strm.adler, dictionary, dictLength, 0);
  }

  s.wrap = 0;   /* avoid computing Adler-32 in read_buf */

  /* if dictionary would fill window, just replace the history */
  if (dictLength >= s.w_size) {
    if (wrap === 0) {            /* already empty otherwise */
      /*** CLEAR_HASH(s); ***/
      zero(s.head); // Fill with NIL (= 0);
      s.strstart = 0;
      s.block_start = 0;
      s.insert = 0;
    }
    /* use the tail */
    // dictionary = dictionary.slice(dictLength - s.w_size);
    let tmpDict = new Uint8Array(s.w_size);
    tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
    dictionary = tmpDict;
    dictLength = s.w_size;
  }
  /* insert dictionary into window and hash */
  const avail = strm.avail_in;
  const next = strm.next_in;
  const input = strm.input;
  strm.avail_in = dictLength;
  strm.next_in = 0;
  strm.input = dictionary;
  fill_window(s);
  while (s.lookahead >= MIN_MATCH) {
    let str = s.strstart;
    let n = s.lookahead - (MIN_MATCH - 1);
    do {
      /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

      s.prev[str & s.w_mask] = s.head[s.ins_h];

      s.head[s.ins_h] = str;
      str++;
    } while (--n);
    s.strstart = str;
    s.lookahead = MIN_MATCH - 1;
    fill_window(s);
  }
  s.strstart += s.lookahead;
  s.block_start = s.strstart;
  s.insert = s.lookahead;
  s.lookahead = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  strm.next_in = next;
  strm.input = input;
  strm.avail_in = avail;
  s.wrap = wrap;
  return Z_OK;
};


module.exports.deflateInit = deflateInit;
module.exports.deflateInit2 = deflateInit2;
module.exports.deflateReset = deflateReset;
module.exports.deflateResetKeep = deflateResetKeep;
module.exports.deflateSetHeader = deflateSetHeader;
module.exports.deflate = deflate;
module.exports.deflateEnd = deflateEnd;
module.exports.deflateSetDictionary = deflateSetDictionary;
module.exports.deflateInfo = 'pako deflate (from Nodeca project)';

/* Not implemented
module.exports.deflateBound = deflateBound;
module.exports.deflateCopy = deflateCopy;
module.exports.deflateGetDictionary = deflateGetDictionary;
module.exports.deflateParams = deflateParams;
module.exports.deflatePending = deflatePending;
module.exports.deflatePrime = deflatePrime;
module.exports.deflateTune = deflateTune;
*/

},{"./adler32":33,"./constants":34,"./crc32":35,"./messages":41,"./trees":42}],37:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function GZheader() {
  /* true if compressed data believed to be text */
  this.text       = 0;
  /* modification time */
  this.time       = 0;
  /* extra flags (not used when writing a gzip file) */
  this.xflags     = 0;
  /* operating system */
  this.os         = 0;
  /* pointer to extra field or Z_NULL if none */
  this.extra      = null;
  /* extra field length (valid if extra != Z_NULL) */
  this.extra_len  = 0; // Actually, we don't need it in JS,
                       // but leave for few code modifications

  //
  // Setup limits is not necessary because in js we should not preallocate memory
  // for inflate use constant limit in 65536 bytes
  //

  /* space at extra (only when reading header) */
  // this.extra_max  = 0;
  /* pointer to zero-terminated file name or Z_NULL */
  this.name       = '';
  /* space at name (only when reading header) */
  // this.name_max   = 0;
  /* pointer to zero-terminated comment or Z_NULL */
  this.comment    = '';
  /* space at comment (only when reading header) */
  // this.comm_max   = 0;
  /* true if there was or will be a header crc */
  this.hcrc       = 0;
  /* true when done reading gzip header (not used when writing a gzip file) */
  this.done       = false;
}

module.exports = GZheader;

},{}],38:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// See state defs from inflate.js
const BAD = 16209;       /* got a data error -- remain here until reset */
const TYPE = 16191;      /* i: waiting for type bits, including last-flag bit */

/*
   Decode literal, length, and distance codes and write out the resulting
   literal and match bytes until either not enough input or output is
   available, an end-of-block is encountered, or a data error is encountered.
   When large enough input and output buffers are supplied to inflate(), for
   example, a 16K input buffer and a 64K output buffer, more than 95% of the
   inflate execution time is spent in this routine.

   Entry assumptions:

        state.mode === LEN
        strm.avail_in >= 6
        strm.avail_out >= 258
        start >= strm.avail_out
        state.bits < 8

   On return, state.mode is one of:

        LEN -- ran out of enough output space or enough available input
        TYPE -- reached end of block code, inflate() to interpret next block
        BAD -- error in block data

   Notes:

    - The maximum input bits used by a length/distance pair is 15 bits for the
      length code, 5 bits for the length extra, 15 bits for the distance code,
      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.
      Therefore if strm.avail_in >= 6, then there is enough input to avoid
      checking for available input while decoding.

    - The maximum bytes that a single length/distance pair can output is 258
      bytes, which is the maximum length that can be coded.  inflate_fast()
      requires strm.avail_out >= 258 for each loop to avoid checking for
      output space.
 */
module.exports = function inflate_fast(strm, start) {
  let _in;                    /* local strm.input */
  let last;                   /* have enough input while in < last */
  let _out;                   /* local strm.output */
  let beg;                    /* inflate()'s initial strm.output */
  let end;                    /* while out < end, enough space available */
//#ifdef INFLATE_STRICT
  let dmax;                   /* maximum distance from zlib header */
//#endif
  let wsize;                  /* window size or zero if not using window */
  let whave;                  /* valid bytes in the window */
  let wnext;                  /* window write index */
  // Use `s_window` instead `window`, avoid conflict with instrumentation tools
  let s_window;               /* allocated sliding window, if wsize != 0 */
  let hold;                   /* local strm.hold */
  let bits;                   /* local strm.bits */
  let lcode;                  /* local strm.lencode */
  let dcode;                  /* local strm.distcode */
  let lmask;                  /* mask for first level of length codes */
  let dmask;                  /* mask for first level of distance codes */
  let here;                   /* retrieved table entry */
  let op;                     /* code bits, operation, extra bits, or */
                              /*  window position, window bytes to copy */
  let len;                    /* match length, unused bytes */
  let dist;                   /* match distance */
  let from;                   /* where to copy match from */
  let from_source;


  let input, output; // JS specific, because we have no pointers

  /* copy state to local variables */
  const state = strm.state;
  //here = state.here;
  _in = strm.next_in;
  input = strm.input;
  last = _in + (strm.avail_in - 5);
  _out = strm.next_out;
  output = strm.output;
  beg = _out - (start - strm.avail_out);
  end = _out + (strm.avail_out - 257);
//#ifdef INFLATE_STRICT
  dmax = state.dmax;
//#endif
  wsize = state.wsize;
  whave = state.whave;
  wnext = state.wnext;
  s_window = state.window;
  hold = state.hold;
  bits = state.bits;
  lcode = state.lencode;
  dcode = state.distcode;
  lmask = (1 << state.lenbits) - 1;
  dmask = (1 << state.distbits) - 1;


  /* decode literals and length/distances until end-of-block or not enough
     input data or output space */

  top:
  do {
    if (bits < 15) {
      hold += input[_in++] << bits;
      bits += 8;
      hold += input[_in++] << bits;
      bits += 8;
    }

    here = lcode[hold & lmask];

    dolen:
    for (;;) { // Goto emulation
      op = here >>> 24/*here.bits*/;
      hold >>>= op;
      bits -= op;
      op = (here >>> 16) & 0xff/*here.op*/;
      if (op === 0) {                          /* literal */
        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
        //        "inflate:         literal '%c'\n" :
        //        "inflate:         literal 0x%02x\n", here.val));
        output[_out++] = here & 0xffff/*here.val*/;
      }
      else if (op & 16) {                     /* length base */
        len = here & 0xffff/*here.val*/;
        op &= 15;                           /* number of extra bits */
        if (op) {
          if (bits < op) {
            hold += input[_in++] << bits;
            bits += 8;
          }
          len += hold & ((1 << op) - 1);
          hold >>>= op;
          bits -= op;
        }
        //Tracevv((stderr, "inflate:         length %u\n", len));
        if (bits < 15) {
          hold += input[_in++] << bits;
          bits += 8;
          hold += input[_in++] << bits;
          bits += 8;
        }
        here = dcode[hold & dmask];

        dodist:
        for (;;) { // goto emulation
          op = here >>> 24/*here.bits*/;
          hold >>>= op;
          bits -= op;
          op = (here >>> 16) & 0xff/*here.op*/;

          if (op & 16) {                      /* distance base */
            dist = here & 0xffff/*here.val*/;
            op &= 15;                       /* number of extra bits */
            if (bits < op) {
              hold += input[_in++] << bits;
              bits += 8;
              if (bits < op) {
                hold += input[_in++] << bits;
                bits += 8;
              }
            }
            dist += hold & ((1 << op) - 1);
//#ifdef INFLATE_STRICT
            if (dist > dmax) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break top;
            }
//#endif
            hold >>>= op;
            bits -= op;
            //Tracevv((stderr, "inflate:         distance %u\n", dist));
            op = _out - beg;                /* max distance in output */
            if (dist > op) {                /* see if copy from window */
              op = dist - op;               /* distance back in window */
              if (op > whave) {
                if (state.sane) {
                  strm.msg = 'invalid distance too far back';
                  state.mode = BAD;
                  break top;
                }

// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//                if (len <= op - whave) {
//                  do {
//                    output[_out++] = 0;
//                  } while (--len);
//                  continue top;
//                }
//                len -= op - whave;
//                do {
//                  output[_out++] = 0;
//                } while (--op > whave);
//                if (op === 0) {
//                  from = _out - dist;
//                  do {
//                    output[_out++] = output[from++];
//                  } while (--len);
//                  continue top;
//                }
//#endif
              }
              from = 0; // window index
              from_source = s_window;
              if (wnext === 0) {           /* very common case */
                from += wsize - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              else if (wnext < op) {      /* wrap around window */
                from += wsize + wnext - op;
                op -= wnext;
                if (op < len) {         /* some from end of window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = 0;
                  if (wnext < len) {  /* some from start of window */
                    op = wnext;
                    len -= op;
                    do {
                      output[_out++] = s_window[from++];
                    } while (--op);
                    from = _out - dist;      /* rest from output */
                    from_source = output;
                  }
                }
              }
              else {                      /* contiguous in window */
                from += wnext - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              while (len > 2) {
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                len -= 3;
              }
              if (len) {
                output[_out++] = from_source[from++];
                if (len > 1) {
                  output[_out++] = from_source[from++];
                }
              }
            }
            else {
              from = _out - dist;          /* copy direct from output */
              do {                        /* minimum length is three */
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                len -= 3;
              } while (len > 2);
              if (len) {
                output[_out++] = output[from++];
                if (len > 1) {
                  output[_out++] = output[from++];
                }
              }
            }
          }
          else if ((op & 64) === 0) {          /* 2nd level distance code */
            here = dcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
            continue dodist;
          }
          else {
            strm.msg = 'invalid distance code';
            state.mode = BAD;
            break top;
          }

          break; // need to emulate goto via "continue"
        }
      }
      else if ((op & 64) === 0) {              /* 2nd level length code */
        here = lcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
        continue dolen;
      }
      else if (op & 32) {                     /* end-of-block */
        //Tracevv((stderr, "inflate:         end of block\n"));
        state.mode = TYPE;
        break top;
      }
      else {
        strm.msg = 'invalid literal/length code';
        state.mode = BAD;
        break top;
      }

      break; // need to emulate goto via "continue"
    }
  } while (_in < last && _out < end);

  /* return unused bytes (on entry, bits < 8, so in won't go too far back) */
  len = bits >> 3;
  _in -= len;
  bits -= len << 3;
  hold &= (1 << bits) - 1;

  /* update state and return */
  strm.next_in = _in;
  strm.next_out = _out;
  strm.avail_in = (_in < last ? 5 + (last - _in) : 5 - (_in - last));
  strm.avail_out = (_out < end ? 257 + (end - _out) : 257 - (_out - end));
  state.hold = hold;
  state.bits = bits;
  return;
};

},{}],39:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32       = require('./adler32');
const crc32         = require('./crc32');
const inflate_fast  = require('./inffast');
const inflate_table = require('./inftrees');

const CODES = 0;
const LENS = 1;
const DISTS = 2;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_FINISH, Z_BLOCK, Z_TREES,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR, Z_BUF_ERROR,
  Z_DEFLATED
} = require('./constants');


/* STATES ====================================================================*/
/* ===========================================================================*/


const    HEAD = 16180;       /* i: waiting for magic header */
const    FLAGS = 16181;      /* i: waiting for method and flags (gzip) */
const    TIME = 16182;       /* i: waiting for modification time (gzip) */
const    OS = 16183;         /* i: waiting for extra flags and operating system (gzip) */
const    EXLEN = 16184;      /* i: waiting for extra length (gzip) */
const    EXTRA = 16185;      /* i: waiting for extra bytes (gzip) */
const    NAME = 16186;       /* i: waiting for end of file name (gzip) */
const    COMMENT = 16187;    /* i: waiting for end of comment (gzip) */
const    HCRC = 16188;       /* i: waiting for header crc (gzip) */
const    DICTID = 16189;    /* i: waiting for dictionary check value */
const    DICT = 16190;      /* waiting for inflateSetDictionary() call */
const        TYPE = 16191;      /* i: waiting for type bits, including last-flag bit */
const        TYPEDO = 16192;    /* i: same, but skip check to exit inflate on new block */
const        STORED = 16193;    /* i: waiting for stored size (length and complement) */
const        COPY_ = 16194;     /* i/o: same as COPY below, but only first time in */
const        COPY = 16195;      /* i/o: waiting for input or output to copy stored block */
const        TABLE = 16196;     /* i: waiting for dynamic block table lengths */
const        LENLENS = 16197;   /* i: waiting for code length code lengths */
const        CODELENS = 16198;  /* i: waiting for length/lit and distance code lengths */
const            LEN_ = 16199;      /* i: same as LEN below, but only first time in */
const            LEN = 16200;       /* i: waiting for length/lit/eob code */
const            LENEXT = 16201;    /* i: waiting for length extra bits */
const            DIST = 16202;      /* i: waiting for distance code */
const            DISTEXT = 16203;   /* i: waiting for distance extra bits */
const            MATCH = 16204;     /* o: waiting for output space to copy string */
const            LIT = 16205;       /* o: waiting for output space to write literal */
const    CHECK = 16206;     /* i: waiting for 32-bit check value */
const    LENGTH = 16207;    /* i: waiting for 32-bit length (gzip) */
const    DONE = 16208;      /* finished check, done -- remain here until reset */
const    BAD = 16209;       /* got a data error -- remain here until reset */
const    MEM = 16210;       /* got an inflate() memory error -- remain here until reset */
const    SYNC = 16211;      /* looking for synchronization bytes to restart inflate() */

/* ===========================================================================*/



const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH =  (ENOUGH_LENS+ENOUGH_DISTS);

const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_WBITS = MAX_WBITS;


const zswap32 = (q) => {

  return  (((q >>> 24) & 0xff) +
          ((q >>> 8) & 0xff00) +
          ((q & 0xff00) << 8) +
          ((q & 0xff) << 24));
};


function InflateState() {
  this.strm = null;           /* pointer back to this zlib stream */
  this.mode = 0;              /* current inflate mode */
  this.last = false;          /* true if processing last block */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip,
                                 bit 2 true to validate check value */
  this.havedict = false;      /* true if dictionary provided */
  this.flags = 0;             /* gzip header method and flags (0 if zlib), or
                                 -1 if raw or no header yet */
  this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */
  this.check = 0;             /* protected copy of check value */
  this.total = 0;             /* protected copy of output count */
  // TODO: may be {}
  this.head = null;           /* where to save gzip header information */

  /* sliding window */
  this.wbits = 0;             /* log base 2 of requested window size */
  this.wsize = 0;             /* window size or zero if not using window */
  this.whave = 0;             /* valid bytes in the window */
  this.wnext = 0;             /* window write index */
  this.window = null;         /* allocated sliding window, if needed */

  /* bit accumulator */
  this.hold = 0;              /* input bit accumulator */
  this.bits = 0;              /* number of bits in "in" */

  /* for string and stored block copying */
  this.length = 0;            /* literal or length of data to copy */
  this.offset = 0;            /* distance back to copy string from */

  /* for table and code decoding */
  this.extra = 0;             /* extra bits needed */

  /* fixed and dynamic code tables */
  this.lencode = null;          /* starting table for length/literal codes */
  this.distcode = null;         /* starting table for distance codes */
  this.lenbits = 0;           /* index bits for lencode */
  this.distbits = 0;          /* index bits for distcode */

  /* dynamic table building */
  this.ncode = 0;             /* number of code length code lengths */
  this.nlen = 0;              /* number of length code lengths */
  this.ndist = 0;             /* number of distance code lengths */
  this.have = 0;              /* number of code lengths in lens[] */
  this.next = null;              /* next available space in codes[] */

  this.lens = new Uint16Array(320); /* temporary storage for code lengths */
  this.work = new Uint16Array(288); /* work area for code table building */

  /*
   because we don't have pointers in js, we use lencode and distcode directly
   as buffers so we don't need codes
  */
  //this.codes = new Int32Array(ENOUGH);       /* space for code tables */
  this.lendyn = null;              /* dynamic table for length/literal codes (JS specific) */
  this.distdyn = null;             /* dynamic table for distance codes (JS specific) */
  this.sane = 0;                   /* if false, allow invalid distance too far */
  this.back = 0;                   /* bits back of last unprocessed length/lit */
  this.was = 0;                    /* initial length of match */
}


const inflateStateCheck = (strm) => {

  if (!strm) {
    return 1;
  }
  const state = strm.state;
  if (!state || state.strm !== strm ||
    state.mode < HEAD || state.mode > SYNC) {
    return 1;
  }
  return 0;
};


const inflateResetKeep = (strm) => {

  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  strm.total_in = strm.total_out = state.total = 0;
  strm.msg = ''; /*Z_NULL*/
  if (state.wrap) {       /* to support ill-conceived Java test suite */
    strm.adler = state.wrap & 1;
  }
  state.mode = HEAD;
  state.last = 0;
  state.havedict = 0;
  state.flags = -1;
  state.dmax = 32768;
  state.head = null/*Z_NULL*/;
  state.hold = 0;
  state.bits = 0;
  //state.lencode = state.distcode = state.next = state.codes;
  state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
  state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);

  state.sane = 1;
  state.back = -1;
  //Tracev((stderr, "inflate: reset\n"));
  return Z_OK;
};


const inflateReset = (strm) => {

  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  state.wsize = 0;
  state.whave = 0;
  state.wnext = 0;
  return inflateResetKeep(strm);

};


const inflateReset2 = (strm, windowBits) => {
  let wrap;

  /* get the state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;

  /* extract wrap request from windowBits parameter */
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  }
  else {
    wrap = (windowBits >> 4) + 5;
    if (windowBits < 48) {
      windowBits &= 15;
    }
  }

  /* set number of window bits, free window if different */
  if (windowBits && (windowBits < 8 || windowBits > 15)) {
    return Z_STREAM_ERROR;
  }
  if (state.window !== null && state.wbits !== windowBits) {
    state.window = null;
  }

  /* update state and reset the rest of it */
  state.wrap = wrap;
  state.wbits = windowBits;
  return inflateReset(strm);
};


const inflateInit2 = (strm, windowBits) => {

  if (!strm) { return Z_STREAM_ERROR; }
  //strm.msg = Z_NULL;                 /* in case we return an error */

  const state = new InflateState();

  //if (state === Z_NULL) return Z_MEM_ERROR;
  //Tracev((stderr, "inflate: allocated\n"));
  strm.state = state;
  state.strm = strm;
  state.window = null/*Z_NULL*/;
  state.mode = HEAD;     /* to pass state test in inflateReset2() */
  const ret = inflateReset2(strm, windowBits);
  if (ret !== Z_OK) {
    strm.state = null/*Z_NULL*/;
  }
  return ret;
};


const inflateInit = (strm) => {

  return inflateInit2(strm, DEF_WBITS);
};


/*
 Return state with length and distance decoding tables and index sizes set to
 fixed code decoding.  Normally this returns fixed tables from inffixed.h.
 If BUILDFIXED is defined, then instead this routine builds the tables the
 first time it's called, and returns those tables the first time and
 thereafter.  This reduces the size of the code by about 2K bytes, in
 exchange for a little execution time.  However, BUILDFIXED should not be
 used for threaded applications, since the rewriting of the tables and virgin
 may not be thread-safe.
 */
let virgin = true;

let lenfix, distfix; // We have no pointers in JS, so keep tables separate


const fixedtables = (state) => {

  /* build fixed huffman tables if first call (may not be thread safe) */
  if (virgin) {
    lenfix = new Int32Array(512);
    distfix = new Int32Array(32);

    /* literal/length table */
    let sym = 0;
    while (sym < 144) { state.lens[sym++] = 8; }
    while (sym < 256) { state.lens[sym++] = 9; }
    while (sym < 280) { state.lens[sym++] = 7; }
    while (sym < 288) { state.lens[sym++] = 8; }

    inflate_table(LENS,  state.lens, 0, 288, lenfix,   0, state.work, { bits: 9 });

    /* distance table */
    sym = 0;
    while (sym < 32) { state.lens[sym++] = 5; }

    inflate_table(DISTS, state.lens, 0, 32,   distfix, 0, state.work, { bits: 5 });

    /* do this just once */
    virgin = false;
  }

  state.lencode = lenfix;
  state.lenbits = 9;
  state.distcode = distfix;
  state.distbits = 5;
};


/*
 Update the window with the last wsize (normally 32K) bytes written before
 returning.  If window does not exist yet, create it.  This is only called
 when a window is already in use, or when output has been written during this
 inflate call, but the end of the deflate stream has not been reached yet.
 It is also called to create a window for dictionary data when a dictionary
 is loaded.

 Providing output buffers larger than 32K to inflate() should provide a speed
 advantage, since only the last 32K of output is copied to the sliding window
 upon return from inflate(), and since all distances after the first 32K of
 output will fall in the output data, making match copies simpler and faster.
 The advantage may be dependent on the size of the processor's data caches.
 */
const updatewindow = (strm, src, end, copy) => {

  let dist;
  const state = strm.state;

  /* if it hasn't been done already, allocate space for the window */
  if (state.window === null) {
    state.wsize = 1 << state.wbits;
    state.wnext = 0;
    state.whave = 0;

    state.window = new Uint8Array(state.wsize);
  }

  /* copy state->wsize or less output bytes into the circular window */
  if (copy >= state.wsize) {
    state.window.set(src.subarray(end - state.wsize, end), 0);
    state.wnext = 0;
    state.whave = state.wsize;
  }
  else {
    dist = state.wsize - state.wnext;
    if (dist > copy) {
      dist = copy;
    }
    //zmemcpy(state->window + state->wnext, end - copy, dist);
    state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
    copy -= dist;
    if (copy) {
      //zmemcpy(state->window, end - copy, copy);
      state.window.set(src.subarray(end - copy, end), 0);
      state.wnext = copy;
      state.whave = state.wsize;
    }
    else {
      state.wnext += dist;
      if (state.wnext === state.wsize) { state.wnext = 0; }
      if (state.whave < state.wsize) { state.whave += dist; }
    }
  }
  return 0;
};


const inflate = (strm, flush) => {

  let state;
  let input, output;          // input/output buffers
  let next;                   /* next input INDEX */
  let put;                    /* next output INDEX */
  let have, left;             /* available input and output */
  let hold;                   /* bit buffer */
  let bits;                   /* bits in bit buffer */
  let _in, _out;              /* save starting available input and output */
  let copy;                   /* number of stored or match bytes to copy */
  let from;                   /* where to copy match bytes from */
  let from_source;
  let here = 0;               /* current decoding table entry */
  let here_bits, here_op, here_val; // paked "here" denormalized (JS specific)
  //let last;                   /* parent table entry */
  let last_bits, last_op, last_val; // paked "last" denormalized (JS specific)
  let len;                    /* length to copy for repeats, bits to drop */
  let ret;                    /* return code */
  const hbuf = new Uint8Array(4);    /* buffer for gzip header crc calculation */
  let opts;

  let n; // temporary variable for NEED_BITS

  const order = /* permutation of code lengths */
    new Uint8Array([ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ]);


  if (inflateStateCheck(strm) || !strm.output ||
      (!strm.input && strm.avail_in !== 0)) {
    return Z_STREAM_ERROR;
  }

  state = strm.state;
  if (state.mode === TYPE) { state.mode = TYPEDO; }    /* skip check */


  //--- LOAD() ---
  put = strm.next_out;
  output = strm.output;
  left = strm.avail_out;
  next = strm.next_in;
  input = strm.input;
  have = strm.avail_in;
  hold = state.hold;
  bits = state.bits;
  //---

  _in = have;
  _out = left;
  ret = Z_OK;

  inf_leave: // goto emulation
  for (;;) {
    switch (state.mode) {
      case HEAD:
        if (state.wrap === 0) {
          state.mode = TYPEDO;
          break;
        }
        //=== NEEDBITS(16);
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((state.wrap & 2) && hold === 0x8b1f) {  /* gzip header */
          if (state.wbits === 0) {
            state.wbits = 15;
          }
          state.check = 0/*crc32(0L, Z_NULL, 0)*/;
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//

          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          state.mode = FLAGS;
          break;
        }
        if (state.head) {
          state.head.done = false;
        }
        if (!(state.wrap & 1) ||   /* check if zlib header allowed */
          (((hold & 0xff)/*BITS(8)*/ << 8) + (hold >> 8)) % 31) {
          strm.msg = 'incorrect header check';
          state.mode = BAD;
          break;
        }
        if ((hold & 0x0f)/*BITS(4)*/ !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
        len = (hold & 0x0f)/*BITS(4)*/ + 8;
        if (state.wbits === 0) {
          state.wbits = len;
        }
        if (len > 15 || len > state.wbits) {
          strm.msg = 'invalid window size';
          state.mode = BAD;
          break;
        }

        // !!! pako patch. Force use `options.windowBits` if passed.
        // Required to always use max window size by default.
        state.dmax = 1 << state.wbits;
        //state.dmax = 1 << len;

        state.flags = 0;               /* indicate zlib header */
        //Tracev((stderr, "inflate:   zlib header ok\n"));
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = hold & 0x200 ? DICTID : TYPE;
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        break;
      case FLAGS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.flags = hold;
        if ((state.flags & 0xff) !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        if (state.flags & 0xe000) {
          strm.msg = 'unknown header flags set';
          state.mode = BAD;
          break;
        }
        if (state.head) {
          state.head.text = ((hold >> 8) & 1);
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = TIME;
        /* falls through */
      case TIME:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.time = hold;
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC4(state.check, hold)
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          hbuf[2] = (hold >>> 16) & 0xff;
          hbuf[3] = (hold >>> 24) & 0xff;
          state.check = crc32(state.check, hbuf, 4, 0);
          //===
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = OS;
        /* falls through */
      case OS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.xflags = (hold & 0xff);
          state.head.os = (hold >> 8);
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = EXLEN;
        /* falls through */
      case EXLEN:
        if (state.flags & 0x0400) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length = hold;
          if (state.head) {
            state.head.extra_len = hold;
          }
          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            //=== CRC2(state.check, hold);
            hbuf[0] = hold & 0xff;
            hbuf[1] = (hold >>> 8) & 0xff;
            state.check = crc32(state.check, hbuf, 2, 0);
            //===//
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        else if (state.head) {
          state.head.extra = null/*Z_NULL*/;
        }
        state.mode = EXTRA;
        /* falls through */
      case EXTRA:
        if (state.flags & 0x0400) {
          copy = state.length;
          if (copy > have) { copy = have; }
          if (copy) {
            if (state.head) {
              len = state.head.extra_len - state.length;
              if (!state.head.extra) {
                // Use untyped array for more convenient processing later
                state.head.extra = new Uint8Array(state.head.extra_len);
              }
              state.head.extra.set(
                input.subarray(
                  next,
                  // extra field is limited to 65536 bytes
                  // - no need for additional size check
                  next + copy
                ),
                /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                len
              );
              //zmemcpy(state.head.extra + len, next,
              //        len + copy > state.head.extra_max ?
              //        state.head.extra_max - len : copy);
            }
            if ((state.flags & 0x0200) && (state.wrap & 4)) {
              state.check = crc32(state.check, input, copy, next);
            }
            have -= copy;
            next += copy;
            state.length -= copy;
          }
          if (state.length) { break inf_leave; }
        }
        state.length = 0;
        state.mode = NAME;
        /* falls through */
      case NAME:
        if (state.flags & 0x0800) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            // TODO: 2 or 1 bytes?
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.name_max*/)) {
              state.head.name += String.fromCharCode(len);
            }
          } while (len && copy < have);

          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.name = null;
        }
        state.length = 0;
        state.mode = COMMENT;
        /* falls through */
      case COMMENT:
        if (state.flags & 0x1000) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.comm_max*/)) {
              state.head.comment += String.fromCharCode(len);
            }
          } while (len && copy < have);
          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.comment = null;
        }
        state.mode = HCRC;
        /* falls through */
      case HCRC:
        if (state.flags & 0x0200) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if ((state.wrap & 4) && hold !== (state.check & 0xffff)) {
            strm.msg = 'header crc mismatch';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        if (state.head) {
          state.head.hcrc = ((state.flags >> 9) & 1);
          state.head.done = true;
        }
        strm.adler = state.check = 0;
        state.mode = TYPE;
        break;
      case DICTID:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        strm.adler = state.check = zswap32(hold);
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = DICT;
        /* falls through */
      case DICT:
        if (state.havedict === 0) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          return Z_NEED_DICT;
        }
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = TYPE;
        /* falls through */
      case TYPE:
        if (flush === Z_BLOCK || flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case TYPEDO:
        if (state.last) {
          //--- BYTEBITS() ---//
          hold >>>= bits & 7;
          bits -= bits & 7;
          //---//
          state.mode = CHECK;
          break;
        }
        //=== NEEDBITS(3); */
        while (bits < 3) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.last = (hold & 0x01)/*BITS(1)*/;
        //--- DROPBITS(1) ---//
        hold >>>= 1;
        bits -= 1;
        //---//

        switch ((hold & 0x03)/*BITS(2)*/) {
          case 0:                             /* stored block */
            //Tracev((stderr, "inflate:     stored block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = STORED;
            break;
          case 1:                             /* fixed block */
            fixedtables(state);
            //Tracev((stderr, "inflate:     fixed codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = LEN_;             /* decode codes */
            if (flush === Z_TREES) {
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
              break inf_leave;
            }
            break;
          case 2:                             /* dynamic block */
            //Tracev((stderr, "inflate:     dynamic codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = TABLE;
            break;
          case 3:
            strm.msg = 'invalid block type';
            state.mode = BAD;
        }
        //--- DROPBITS(2) ---//
        hold >>>= 2;
        bits -= 2;
        //---//
        break;
      case STORED:
        //--- BYTEBITS() ---// /* go to byte boundary */
        hold >>>= bits & 7;
        bits -= bits & 7;
        //---//
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((hold & 0xffff) !== ((hold >>> 16) ^ 0xffff)) {
          strm.msg = 'invalid stored block lengths';
          state.mode = BAD;
          break;
        }
        state.length = hold & 0xffff;
        //Tracev((stderr, "inflate:       stored length %u\n",
        //        state.length));
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = COPY_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case COPY_:
        state.mode = COPY;
        /* falls through */
      case COPY:
        copy = state.length;
        if (copy) {
          if (copy > have) { copy = have; }
          if (copy > left) { copy = left; }
          if (copy === 0) { break inf_leave; }
          //--- zmemcpy(put, next, copy); ---
          output.set(input.subarray(next, next + copy), put);
          //---//
          have -= copy;
          next += copy;
          left -= copy;
          put += copy;
          state.length -= copy;
          break;
        }
        //Tracev((stderr, "inflate:       stored end\n"));
        state.mode = TYPE;
        break;
      case TABLE:
        //=== NEEDBITS(14); */
        while (bits < 14) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.nlen = (hold & 0x1f)/*BITS(5)*/ + 257;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ndist = (hold & 0x1f)/*BITS(5)*/ + 1;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ncode = (hold & 0x0f)/*BITS(4)*/ + 4;
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
//#ifndef PKZIP_BUG_WORKAROUND
        if (state.nlen > 286 || state.ndist > 30) {
          strm.msg = 'too many length or distance symbols';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracev((stderr, "inflate:       table sizes ok\n"));
        state.have = 0;
        state.mode = LENLENS;
        /* falls through */
      case LENLENS:
        while (state.have < state.ncode) {
          //=== NEEDBITS(3);
          while (bits < 3) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.lens[order[state.have++]] = (hold & 0x07);//BITS(3);
          //--- DROPBITS(3) ---//
          hold >>>= 3;
          bits -= 3;
          //---//
        }
        while (state.have < 19) {
          state.lens[order[state.have++]] = 0;
        }
        // We have separate tables & no pointers. 2 commented lines below not needed.
        //state.next = state.codes;
        //state.lencode = state.next;
        // Switch to use dynamic table
        state.lencode = state.lendyn;
        state.lenbits = 7;

        opts = { bits: state.lenbits };
        ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
        state.lenbits = opts.bits;

        if (ret) {
          strm.msg = 'invalid code lengths set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, "inflate:       code lengths ok\n"));
        state.have = 0;
        state.mode = CODELENS;
        /* falls through */
      case CODELENS:
        while (state.have < state.nlen + state.ndist) {
          for (;;) {
            here = state.lencode[hold & ((1 << state.lenbits) - 1)];/*BITS(state.lenbits)*/
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          if (here_val < 16) {
            //--- DROPBITS(here.bits) ---//
            hold >>>= here_bits;
            bits -= here_bits;
            //---//
            state.lens[state.have++] = here_val;
          }
          else {
            if (here_val === 16) {
              //=== NEEDBITS(here.bits + 2);
              n = here_bits + 2;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              if (state.have === 0) {
                strm.msg = 'invalid bit length repeat';
                state.mode = BAD;
                break;
              }
              len = state.lens[state.have - 1];
              copy = 3 + (hold & 0x03);//BITS(2);
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
            }
            else if (here_val === 17) {
              //=== NEEDBITS(here.bits + 3);
              n = here_bits + 3;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 3 + (hold & 0x07);//BITS(3);
              //--- DROPBITS(3) ---//
              hold >>>= 3;
              bits -= 3;
              //---//
            }
            else {
              //=== NEEDBITS(here.bits + 7);
              n = here_bits + 7;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 11 + (hold & 0x7f);//BITS(7);
              //--- DROPBITS(7) ---//
              hold >>>= 7;
              bits -= 7;
              //---//
            }
            if (state.have + copy > state.nlen + state.ndist) {
              strm.msg = 'invalid bit length repeat';
              state.mode = BAD;
              break;
            }
            while (copy--) {
              state.lens[state.have++] = len;
            }
          }
        }

        /* handle error breaks in while */
        if (state.mode === BAD) { break; }

        /* check for end-of-block code (better have one) */
        if (state.lens[256] === 0) {
          strm.msg = 'invalid code -- missing end-of-block';
          state.mode = BAD;
          break;
        }

        /* build code tables -- note: do not change the lenbits or distbits
           values here (9 and 6) without reading the comments in inftrees.h
           concerning the ENOUGH constants, which depend on those values */
        state.lenbits = 9;

        opts = { bits: state.lenbits };
        ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.lenbits = opts.bits;
        // state.lencode = state.next;

        if (ret) {
          strm.msg = 'invalid literal/lengths set';
          state.mode = BAD;
          break;
        }

        state.distbits = 6;
        //state.distcode.copy(state.codes);
        // Switch to use dynamic table
        state.distcode = state.distdyn;
        opts = { bits: state.distbits };
        ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.distbits = opts.bits;
        // state.distcode = state.next;

        if (ret) {
          strm.msg = 'invalid distances set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, 'inflate:       codes ok\n'));
        state.mode = LEN_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case LEN_:
        state.mode = LEN;
        /* falls through */
      case LEN:
        if (have >= 6 && left >= 258) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          inflate_fast(strm, _out);
          //--- LOAD() ---
          put = strm.next_out;
          output = strm.output;
          left = strm.avail_out;
          next = strm.next_in;
          input = strm.input;
          have = strm.avail_in;
          hold = state.hold;
          bits = state.bits;
          //---

          if (state.mode === TYPE) {
            state.back = -1;
          }
          break;
        }
        state.back = 0;
        for (;;) {
          here = state.lencode[hold & ((1 << state.lenbits) - 1)];  /*BITS(state.lenbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if (here_bits <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if (here_op && (here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.lencode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        state.length = here_val;
        if (here_op === 0) {
          //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
          //        "inflate:         literal '%c'\n" :
          //        "inflate:         literal 0x%02x\n", here.val));
          state.mode = LIT;
          break;
        }
        if (here_op & 32) {
          //Tracevv((stderr, "inflate:         end of block\n"));
          state.back = -1;
          state.mode = TYPE;
          break;
        }
        if (here_op & 64) {
          strm.msg = 'invalid literal/length code';
          state.mode = BAD;
          break;
        }
        state.extra = here_op & 15;
        state.mode = LENEXT;
        /* falls through */
      case LENEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
        //Tracevv((stderr, "inflate:         length %u\n", state.length));
        state.was = state.length;
        state.mode = DIST;
        /* falls through */
      case DIST:
        for (;;) {
          here = state.distcode[hold & ((1 << state.distbits) - 1)];/*BITS(state.distbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if ((here_bits) <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if ((here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.distcode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        if (here_op & 64) {
          strm.msg = 'invalid distance code';
          state.mode = BAD;
          break;
        }
        state.offset = here_val;
        state.extra = (here_op) & 15;
        state.mode = DISTEXT;
        /* falls through */
      case DISTEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.offset += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
//#ifdef INFLATE_STRICT
        if (state.offset > state.dmax) {
          strm.msg = 'invalid distance too far back';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracevv((stderr, "inflate:         distance %u\n", state.offset));
        state.mode = MATCH;
        /* falls through */
      case MATCH:
        if (left === 0) { break inf_leave; }
        copy = _out - left;
        if (state.offset > copy) {         /* copy from window */
          copy = state.offset - copy;
          if (copy > state.whave) {
            if (state.sane) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break;
            }
// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//          Trace((stderr, "inflate.c too far\n"));
//          copy -= state.whave;
//          if (copy > state.length) { copy = state.length; }
//          if (copy > left) { copy = left; }
//          left -= copy;
//          state.length -= copy;
//          do {
//            output[put++] = 0;
//          } while (--copy);
//          if (state.length === 0) { state.mode = LEN; }
//          break;
//#endif
          }
          if (copy > state.wnext) {
            copy -= state.wnext;
            from = state.wsize - copy;
          }
          else {
            from = state.wnext - copy;
          }
          if (copy > state.length) { copy = state.length; }
          from_source = state.window;
        }
        else {                              /* copy from output */
          from_source = output;
          from = put - state.offset;
          copy = state.length;
        }
        if (copy > left) { copy = left; }
        left -= copy;
        state.length -= copy;
        do {
          output[put++] = from_source[from++];
        } while (--copy);
        if (state.length === 0) { state.mode = LEN; }
        break;
      case LIT:
        if (left === 0) { break inf_leave; }
        output[put++] = state.length;
        left--;
        state.mode = LEN;
        break;
      case CHECK:
        if (state.wrap) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            // Use '|' instead of '+' to make sure that result is signed
            hold |= input[next++] << bits;
            bits += 8;
          }
          //===//
          _out -= left;
          strm.total_out += _out;
          state.total += _out;
          if ((state.wrap & 4) && _out) {
            strm.adler = state.check =
                /*UPDATE_CHECK(state.check, put - _out, _out);*/
                (state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out));

          }
          _out = left;
          // NB: crc32 stored as signed 32-bit int, zswap32 returns signed too
          if ((state.wrap & 4) && (state.flags ? hold : zswap32(hold)) !== state.check) {
            strm.msg = 'incorrect data check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   check matches trailer\n"));
        }
        state.mode = LENGTH;
        /* falls through */
      case LENGTH:
        if (state.wrap && state.flags) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if ((state.wrap & 4) && hold !== (state.total & 0xffffffff)) {
            strm.msg = 'incorrect length check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   length matches trailer\n"));
        }
        state.mode = DONE;
        /* falls through */
      case DONE:
        ret = Z_STREAM_END;
        break inf_leave;
      case BAD:
        ret = Z_DATA_ERROR;
        break inf_leave;
      case MEM:
        return Z_MEM_ERROR;
      case SYNC:
        /* falls through */
      default:
        return Z_STREAM_ERROR;
    }
  }

  // inf_leave <- here is real place for "goto inf_leave", emulated via "break inf_leave"

  /*
     Return from inflate(), updating the total counts and the check value.
     If there was no progress during the inflate() call, return a buffer
     error.  Call updatewindow() to create and/or update the window state.
     Note: a memory error from inflate() is non-recoverable.
   */

  //--- RESTORE() ---
  strm.next_out = put;
  strm.avail_out = left;
  strm.next_in = next;
  strm.avail_in = have;
  state.hold = hold;
  state.bits = bits;
  //---

  if (state.wsize || (_out !== strm.avail_out && state.mode < BAD &&
                      (state.mode < CHECK || flush !== Z_FINISH))) {
    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
      state.mode = MEM;
      return Z_MEM_ERROR;
    }
  }
  _in -= strm.avail_in;
  _out -= strm.avail_out;
  strm.total_in += _in;
  strm.total_out += _out;
  state.total += _out;
  if ((state.wrap & 4) && _out) {
    strm.adler = state.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
      (state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out));
  }
  strm.data_type = state.bits + (state.last ? 64 : 0) +
                    (state.mode === TYPE ? 128 : 0) +
                    (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
  if (((_in === 0 && _out === 0) || flush === Z_FINISH) && ret === Z_OK) {
    ret = Z_BUF_ERROR;
  }
  return ret;
};


const inflateEnd = (strm) => {

  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  let state = strm.state;
  if (state.window) {
    state.window = null;
  }
  strm.state = null;
  return Z_OK;
};


const inflateGetHeader = (strm, head) => {

  /* check state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  if ((state.wrap & 2) === 0) { return Z_STREAM_ERROR; }

  /* save header structure */
  state.head = head;
  head.done = false;
  return Z_OK;
};


const inflateSetDictionary = (strm, dictionary) => {
  const dictLength = dictionary.length;

  let state;
  let dictid;
  let ret;

  /* check state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  state = strm.state;

  if (state.wrap !== 0 && state.mode !== DICT) {
    return Z_STREAM_ERROR;
  }

  /* check for correct dictionary identifier */
  if (state.mode === DICT) {
    dictid = 1; /* adler32(0, null, 0)*/
    /* dictid = adler32(dictid, dictionary, dictLength); */
    dictid = adler32(dictid, dictionary, dictLength, 0);
    if (dictid !== state.check) {
      return Z_DATA_ERROR;
    }
  }
  /* copy dictionary to window using updatewindow(), which will amend the
   existing dictionary if appropriate */
  ret = updatewindow(strm, dictionary, dictLength, dictLength);
  if (ret) {
    state.mode = MEM;
    return Z_MEM_ERROR;
  }
  state.havedict = 1;
  // Tracev((stderr, "inflate:   dictionary set\n"));
  return Z_OK;
};


module.exports.inflateReset = inflateReset;
module.exports.inflateReset2 = inflateReset2;
module.exports.inflateResetKeep = inflateResetKeep;
module.exports.inflateInit = inflateInit;
module.exports.inflateInit2 = inflateInit2;
module.exports.inflate = inflate;
module.exports.inflateEnd = inflateEnd;
module.exports.inflateGetHeader = inflateGetHeader;
module.exports.inflateSetDictionary = inflateSetDictionary;
module.exports.inflateInfo = 'pako inflate (from Nodeca project)';

/* Not implemented
module.exports.inflateCodesUsed = inflateCodesUsed;
module.exports.inflateCopy = inflateCopy;
module.exports.inflateGetDictionary = inflateGetDictionary;
module.exports.inflateMark = inflateMark;
module.exports.inflatePrime = inflatePrime;
module.exports.inflateSync = inflateSync;
module.exports.inflateSyncPoint = inflateSyncPoint;
module.exports.inflateUndermine = inflateUndermine;
module.exports.inflateValidate = inflateValidate;
*/

},{"./adler32":33,"./constants":34,"./crc32":35,"./inffast":38,"./inftrees":40}],40:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const MAXBITS = 15;
const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH = (ENOUGH_LENS+ENOUGH_DISTS);

const CODES = 0;
const LENS = 1;
const DISTS = 2;

const lbase = new Uint16Array([ /* Length codes 257..285 base */
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
]);

const lext = new Uint8Array([ /* Length codes 257..285 extra */
  16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,
  19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78
]);

const dbase = new Uint16Array([ /* Distance codes 0..29 base */
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577, 0, 0
]);

const dext = new Uint8Array([ /* Distance codes 0..29 extra */
  16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
  23, 23, 24, 24, 25, 25, 26, 26, 27, 27,
  28, 28, 29, 29, 64, 64
]);

const inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) =>
{
  const bits = opts.bits;
      //here = opts.here; /* table entry for duplication */

  let len = 0;               /* a code's length in bits */
  let sym = 0;               /* index of code symbols */
  let min = 0, max = 0;          /* minimum and maximum code lengths */
  let root = 0;              /* number of index bits for root table */
  let curr = 0;              /* number of index bits for current table */
  let drop = 0;              /* code bits to drop for sub-table */
  let left = 0;                   /* number of prefix codes available */
  let used = 0;              /* code entries in table used */
  let huff = 0;              /* Huffman code */
  let incr;              /* for incrementing code, index */
  let fill;              /* index for replicating entries */
  let low;               /* low bits for current root entry */
  let mask;              /* mask for low root bits */
  let next;             /* next available space in table */
  let base = null;     /* base value table to use */
//  let shoextra;    /* extra bits table to use */
  let match;                  /* use base and extra for symbol >= match */
  const count = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];    /* number of codes of each length */
  const offs = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];     /* offsets in table for each length */
  let extra = null;

  let here_bits, here_op, here_val;

  /*
   Process a set of code lengths to create a canonical Huffman code.  The
   code lengths are lens[0..codes-1].  Each length corresponds to the
   symbols 0..codes-1.  The Huffman code is generated by first sorting the
   symbols by length from short to long, and retaining the symbol order
   for codes with equal lengths.  Then the code starts with all zero bits
   for the first code of the shortest length, and the codes are integer
   increments for the same length, and zeros are appended as the length
   increases.  For the deflate format, these bits are stored backwards
   from their more natural integer increment ordering, and so when the
   decoding tables are built in the large loop below, the integer codes
   are incremented backwards.

   This routine assumes, but does not check, that all of the entries in
   lens[] are in the range 0..MAXBITS.  The caller must assure this.
   1..MAXBITS is interpreted as that code length.  zero means that that
   symbol does not occur in this code.

   The codes are sorted by computing a count of codes for each length,
   creating from that a table of starting indices for each length in the
   sorted table, and then entering the symbols in order in the sorted
   table.  The sorted table is work[], with that space being provided by
   the caller.

   The length counts are used for other purposes as well, i.e. finding
   the minimum and maximum length codes, determining if there are any
   codes at all, checking for a valid set of lengths, and looking ahead
   at length counts to determine sub-table sizes when building the
   decoding tables.
   */

  /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */
  for (len = 0; len <= MAXBITS; len++) {
    count[len] = 0;
  }
  for (sym = 0; sym < codes; sym++) {
    count[lens[lens_index + sym]]++;
  }

  /* bound code lengths, force root to be within code lengths */
  root = bits;
  for (max = MAXBITS; max >= 1; max--) {
    if (count[max] !== 0) { break; }
  }
  if (root > max) {
    root = max;
  }
  if (max === 0) {                     /* no symbols to code at all */
    //table.op[opts.table_index] = 64;  //here.op = (var char)64;    /* invalid code marker */
    //table.bits[opts.table_index] = 1;   //here.bits = (var char)1;
    //table.val[opts.table_index++] = 0;   //here.val = (var short)0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;


    //table.op[opts.table_index] = 64;
    //table.bits[opts.table_index] = 1;
    //table.val[opts.table_index++] = 0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;

    opts.bits = 1;
    return 0;     /* no symbols, but wait for decoding to report error */
  }
  for (min = 1; min < max; min++) {
    if (count[min] !== 0) { break; }
  }
  if (root < min) {
    root = min;
  }

  /* check for an over-subscribed or incomplete set of lengths */
  left = 1;
  for (len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) {
      return -1;
    }        /* over-subscribed */
  }
  if (left > 0 && (type === CODES || max !== 1)) {
    return -1;                      /* incomplete set */
  }

  /* generate offsets into symbol table for each length for sorting */
  offs[1] = 0;
  for (len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len] + count[len];
  }

  /* sort symbols by length, by symbol order within each length */
  for (sym = 0; sym < codes; sym++) {
    if (lens[lens_index + sym] !== 0) {
      work[offs[lens[lens_index + sym]]++] = sym;
    }
  }

  /*
   Create and fill in decoding tables.  In this loop, the table being
   filled is at next and has curr index bits.  The code being used is huff
   with length len.  That code is converted to an index by dropping drop
   bits off of the bottom.  For codes where len is less than drop + curr,
   those top drop + curr - len bits are incremented through all values to
   fill the table with replicated entries.

   root is the number of index bits for the root table.  When len exceeds
   root, sub-tables are created pointed to by the root entry with an index
   of the low root bits of huff.  This is saved in low to check for when a
   new sub-table should be started.  drop is zero when the root table is
   being filled, and drop is root when sub-tables are being filled.

   When a new sub-table is needed, it is necessary to look ahead in the
   code lengths to determine what size sub-table is needed.  The length
   counts are used for this, and so count[] is decremented as codes are
   entered in the tables.

   used keeps track of how many table entries have been allocated from the
   provided *table space.  It is checked for LENS and DIST tables against
   the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in
   the initial root table size constants.  See the comments in inftrees.h
   for more information.

   sym increments through all symbols, and the loop terminates when
   all codes of length max, i.e. all codes, have been processed.  This
   routine permits incomplete codes, so another loop after this one fills
   in the rest of the decoding tables with invalid code markers.
   */

  /* set up for code type */
  // poor man optimization - use if-else instead of switch,
  // to avoid deopts in old v8
  if (type === CODES) {
    base = extra = work;    /* dummy value--not used */
    match = 20;

  } else if (type === LENS) {
    base = lbase;
    extra = lext;
    match = 257;

  } else {                    /* DISTS */
    base = dbase;
    extra = dext;
    match = 0;
  }

  /* initialize opts for loop */
  huff = 0;                   /* starting code */
  sym = 0;                    /* starting code symbol */
  len = min;                  /* starting code length */
  next = table_index;              /* current table to fill in */
  curr = root;                /* current table index bits */
  drop = 0;                   /* current bits to drop from code for index */
  low = -1;                   /* trigger new sub-table when len > root */
  used = 1 << root;          /* use root table entries */
  mask = used - 1;            /* mask for comparing low */

  /* check available table space */
  if ((type === LENS && used > ENOUGH_LENS) ||
    (type === DISTS && used > ENOUGH_DISTS)) {
    return 1;
  }

  /* process all codes and make table entries */
  for (;;) {
    /* create table entry */
    here_bits = len - drop;
    if (work[sym] + 1 < match) {
      here_op = 0;
      here_val = work[sym];
    }
    else if (work[sym] >= match) {
      here_op = extra[work[sym] - match];
      here_val = base[work[sym] - match];
    }
    else {
      here_op = 32 + 64;         /* end of block */
      here_val = 0;
    }

    /* replicate for those indices with low len bits equal to huff */
    incr = 1 << (len - drop);
    fill = 1 << curr;
    min = fill;                 /* save offset to next table */
    do {
      fill -= incr;
      table[next + (huff >> drop) + fill] = (here_bits << 24) | (here_op << 16) | here_val |0;
    } while (fill !== 0);

    /* backwards increment the len-bit code huff */
    incr = 1 << (len - 1);
    while (huff & incr) {
      incr >>= 1;
    }
    if (incr !== 0) {
      huff &= incr - 1;
      huff += incr;
    } else {
      huff = 0;
    }

    /* go to next symbol, update count, len */
    sym++;
    if (--count[len] === 0) {
      if (len === max) { break; }
      len = lens[lens_index + work[sym]];
    }

    /* create new sub-table if needed */
    if (len > root && (huff & mask) !== low) {
      /* if first time, transition to sub-tables */
      if (drop === 0) {
        drop = root;
      }

      /* increment past last table */
      next += min;            /* here min is 1 << curr */

      /* determine length of next table */
      curr = len - drop;
      left = 1 << curr;
      while (curr + drop < max) {
        left -= count[curr + drop];
        if (left <= 0) { break; }
        curr++;
        left <<= 1;
      }

      /* check for enough space */
      used += 1 << curr;
      if ((type === LENS && used > ENOUGH_LENS) ||
        (type === DISTS && used > ENOUGH_DISTS)) {
        return 1;
      }

      /* point entry in root table to sub-table */
      low = huff & mask;
      /*table.op[low] = curr;
      table.bits[low] = root;
      table.val[low] = next - opts.table_index;*/
      table[low] = (root << 24) | (curr << 16) | (next - table_index) |0;
    }
  }

  /* fill in remaining table entry if code is incomplete (guaranteed to have
   at most one remaining entry, since if the code is incomplete, the
   maximum code length that was allowed to get this far is one bit) */
  if (huff !== 0) {
    //table.op[next + huff] = 64;            /* invalid code marker */
    //table.bits[next + huff] = len - drop;
    //table.val[next + huff] = 0;
    table[next + huff] = ((len - drop) << 24) | (64 << 16) |0;
  }

  /* set return parameters */
  //opts.table_index += used;
  opts.bits = root;
  return 0;
};


module.exports = inflate_table;

},{}],41:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {
  2:      'need dictionary',     /* Z_NEED_DICT       2  */
  1:      'stream end',          /* Z_STREAM_END      1  */
  0:      '',                    /* Z_OK              0  */
  '-1':   'file error',          /* Z_ERRNO         (-1) */
  '-2':   'stream error',        /* Z_STREAM_ERROR  (-2) */
  '-3':   'data error',          /* Z_DATA_ERROR    (-3) */
  '-4':   'insufficient memory', /* Z_MEM_ERROR     (-4) */
  '-5':   'buffer error',        /* Z_BUF_ERROR     (-5) */
  '-6':   'incompatible version' /* Z_VERSION_ERROR (-6) */
};

},{}],42:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

/* eslint-disable space-unary-ops */

/* Public constants ==========================================================*/
/* ===========================================================================*/


//const Z_FILTERED          = 1;
//const Z_HUFFMAN_ONLY      = 2;
//const Z_RLE               = 3;
const Z_FIXED               = 4;
//const Z_DEFAULT_STRATEGY  = 0;

/* Possible values of the data_type field (though see inflate()) */
const Z_BINARY              = 0;
const Z_TEXT                = 1;
//const Z_ASCII             = 1; // = Z_TEXT
const Z_UNKNOWN             = 2;

/*============================================================================*/


function zero(buf) { let len = buf.length; while (--len >= 0) { buf[len] = 0; } }

// From zutil.h

const STORED_BLOCK = 0;
const STATIC_TREES = 1;
const DYN_TREES    = 2;
/* The three kinds of block type */

const MIN_MATCH    = 3;
const MAX_MATCH    = 258;
/* The minimum and maximum match lengths */

// From deflate.h
/* ===========================================================================
 * Internal compression state.
 */

const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */

const LITERALS      = 256;
/* number of literal bytes 0..255 */

const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */

const D_CODES       = 30;
/* number of distance codes */

const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */

const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */

const MAX_BITS      = 15;
/* All codes must not exceed MAX_BITS bits */

const Buf_size      = 16;
/* size of bit buffer in bi_buf */


/* ===========================================================================
 * Constants
 */

const MAX_BL_BITS = 7;
/* Bit length codes must not exceed MAX_BL_BITS bits */

const END_BLOCK   = 256;
/* end of block literal code */

const REP_3_6     = 16;
/* repeat previous bit length 3-6 times (2 bits of repeat count) */

const REPZ_3_10   = 17;
/* repeat a zero length 3-10 times  (3 bits of repeat count) */

const REPZ_11_138 = 18;
/* repeat a zero length 11-138 times  (7 bits of repeat count) */

/* eslint-disable comma-spacing,array-bracket-spacing */
const extra_lbits =   /* extra bits for each length code */
  new Uint8Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);

const extra_dbits =   /* extra bits for each distance code */
  new Uint8Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);

const extra_blbits =  /* extra bits for each bit length code */
  new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7]);

const bl_order =
  new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);
/* eslint-enable comma-spacing,array-bracket-spacing */

/* The lengths of the bit length codes are sent in order of decreasing
 * probability, to avoid transmitting the lengths for unused bit length codes.
 */

/* ===========================================================================
 * Local data. These are initialized only once.
 */

// We pre-fill arrays with 0 to avoid uninitialized gaps

const DIST_CODE_LEN = 512; /* see definition of array dist_code below */

// !!!! Use flat array instead of structure, Freq = i*2, Len = i*2+1
const static_ltree  = new Array((L_CODES + 2) * 2);
zero(static_ltree);
/* The static literal tree. Since the bit lengths are imposed, there is no
 * need for the L_CODES extra codes used during heap construction. However
 * The codes 286 and 287 are needed to build a canonical tree (see _tr_init
 * below).
 */

const static_dtree  = new Array(D_CODES * 2);
zero(static_dtree);
/* The static distance tree. (Actually a trivial tree since all codes use
 * 5 bits.)
 */

const _dist_code    = new Array(DIST_CODE_LEN);
zero(_dist_code);
/* Distance codes. The first 256 values correspond to the distances
 * 3 .. 258, the last 256 values correspond to the top 8 bits of
 * the 15 bit distances.
 */

const _length_code  = new Array(MAX_MATCH - MIN_MATCH + 1);
zero(_length_code);
/* length code for each normalized match length (0 == MIN_MATCH) */

const base_length   = new Array(LENGTH_CODES);
zero(base_length);
/* First normalized length for each code (0 = MIN_MATCH) */

const base_dist     = new Array(D_CODES);
zero(base_dist);
/* First normalized distance for each code (0 = distance of 1) */


function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {

  this.static_tree  = static_tree;  /* static tree or NULL */
  this.extra_bits   = extra_bits;   /* extra bits for each code or NULL */
  this.extra_base   = extra_base;   /* base index for extra_bits */
  this.elems        = elems;        /* max number of elements in the tree */
  this.max_length   = max_length;   /* max bit length for the codes */

  // show if `static_tree` has data or dummy - needed for monomorphic objects
  this.has_stree    = static_tree && static_tree.length;
}


let static_l_desc;
let static_d_desc;
let static_bl_desc;


function TreeDesc(dyn_tree, stat_desc) {
  this.dyn_tree = dyn_tree;     /* the dynamic tree */
  this.max_code = 0;            /* largest code with non zero frequency */
  this.stat_desc = stat_desc;   /* the corresponding static tree */
}



const d_code = (dist) => {

  return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
};


/* ===========================================================================
 * Output a short LSB first on the stream.
 * IN assertion: there is enough room in pendingBuf.
 */
const put_short = (s, w) => {
//    put_byte(s, (uch)((w) & 0xff));
//    put_byte(s, (uch)((ush)(w) >> 8));
  s.pending_buf[s.pending++] = (w) & 0xff;
  s.pending_buf[s.pending++] = (w >>> 8) & 0xff;
};


/* ===========================================================================
 * Send a value on a given number of bits.
 * IN assertion: length <= 16 and value fits in length bits.
 */
const send_bits = (s, value, length) => {

  if (s.bi_valid > (Buf_size - length)) {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    put_short(s, s.bi_buf);
    s.bi_buf = value >> (Buf_size - s.bi_valid);
    s.bi_valid += length - Buf_size;
  } else {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    s.bi_valid += length;
  }
};


const send_code = (s, c, tree) => {

  send_bits(s, tree[c * 2]/*.Code*/, tree[c * 2 + 1]/*.Len*/);
};


/* ===========================================================================
 * Reverse the first len bits of a code, using straightforward code (a faster
 * method would use a table)
 * IN assertion: 1 <= len <= 15
 */
const bi_reverse = (code, len) => {

  let res = 0;
  do {
    res |= code & 1;
    code >>>= 1;
    res <<= 1;
  } while (--len > 0);
  return res >>> 1;
};


/* ===========================================================================
 * Flush the bit buffer, keeping at most 7 bits in it.
 */
const bi_flush = (s) => {

  if (s.bi_valid === 16) {
    put_short(s, s.bi_buf);
    s.bi_buf = 0;
    s.bi_valid = 0;

  } else if (s.bi_valid >= 8) {
    s.pending_buf[s.pending++] = s.bi_buf & 0xff;
    s.bi_buf >>= 8;
    s.bi_valid -= 8;
  }
};


/* ===========================================================================
 * Compute the optimal bit lengths for a tree and update the total bit length
 * for the current block.
 * IN assertion: the fields freq and dad are set, heap[heap_max] and
 *    above are the tree nodes sorted by increasing frequency.
 * OUT assertions: the field len is set to the optimal bit length, the
 *     array bl_count contains the frequencies for each bit length.
 *     The length opt_len is updated; static_len is also updated if stree is
 *     not null.
 */
const gen_bitlen = (s, desc) => {
//    deflate_state *s;
//    tree_desc *desc;    /* the tree descriptor */

  const tree            = desc.dyn_tree;
  const max_code        = desc.max_code;
  const stree           = desc.stat_desc.static_tree;
  const has_stree       = desc.stat_desc.has_stree;
  const extra           = desc.stat_desc.extra_bits;
  const base            = desc.stat_desc.extra_base;
  const max_length      = desc.stat_desc.max_length;
  let h;              /* heap index */
  let n, m;           /* iterate over the tree elements */
  let bits;           /* bit length */
  let xbits;          /* extra bits */
  let f;              /* frequency */
  let overflow = 0;   /* number of elements with bit length too large */

  for (bits = 0; bits <= MAX_BITS; bits++) {
    s.bl_count[bits] = 0;
  }

  /* In a first pass, compute the optimal bit lengths (which may
   * overflow in the case of the bit length tree).
   */
  tree[s.heap[s.heap_max] * 2 + 1]/*.Len*/ = 0; /* root of the heap */

  for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
    n = s.heap[h];
    bits = tree[tree[n * 2 + 1]/*.Dad*/ * 2 + 1]/*.Len*/ + 1;
    if (bits > max_length) {
      bits = max_length;
      overflow++;
    }
    tree[n * 2 + 1]/*.Len*/ = bits;
    /* We overwrite tree[n].Dad which is no longer needed */

    if (n > max_code) { continue; } /* not a leaf node */

    s.bl_count[bits]++;
    xbits = 0;
    if (n >= base) {
      xbits = extra[n - base];
    }
    f = tree[n * 2]/*.Freq*/;
    s.opt_len += f * (bits + xbits);
    if (has_stree) {
      s.static_len += f * (stree[n * 2 + 1]/*.Len*/ + xbits);
    }
  }
  if (overflow === 0) { return; }

  // Tracev((stderr,"\nbit length overflow\n"));
  /* This happens for example on obj2 and pic of the Calgary corpus */

  /* Find the first bit length which could increase: */
  do {
    bits = max_length - 1;
    while (s.bl_count[bits] === 0) { bits--; }
    s.bl_count[bits]--;      /* move one leaf down the tree */
    s.bl_count[bits + 1] += 2; /* move one overflow item as its brother */
    s.bl_count[max_length]--;
    /* The brother of the overflow item also moves one step up,
     * but this does not affect bl_count[max_length]
     */
    overflow -= 2;
  } while (overflow > 0);

  /* Now recompute all bit lengths, scanning in increasing frequency.
   * h is still equal to HEAP_SIZE. (It is simpler to reconstruct all
   * lengths instead of fixing only the wrong ones. This idea is taken
   * from 'ar' written by Haruhiko Okumura.)
   */
  for (bits = max_length; bits !== 0; bits--) {
    n = s.bl_count[bits];
    while (n !== 0) {
      m = s.heap[--h];
      if (m > max_code) { continue; }
      if (tree[m * 2 + 1]/*.Len*/ !== bits) {
        // Tracev((stderr,"code %d bits %d->%d\n", m, tree[m].Len, bits));
        s.opt_len += (bits - tree[m * 2 + 1]/*.Len*/) * tree[m * 2]/*.Freq*/;
        tree[m * 2 + 1]/*.Len*/ = bits;
      }
      n--;
    }
  }
};


/* ===========================================================================
 * Generate the codes for a given tree and bit counts (which need not be
 * optimal).
 * IN assertion: the array bl_count contains the bit length statistics for
 * the given tree and the field len is set for all tree elements.
 * OUT assertion: the field code is set for all tree elements of non
 *     zero code length.
 */
const gen_codes = (tree, max_code, bl_count) => {
//    ct_data *tree;             /* the tree to decorate */
//    int max_code;              /* largest code with non zero frequency */
//    ushf *bl_count;            /* number of codes at each bit length */

  const next_code = new Array(MAX_BITS + 1); /* next code value for each bit length */
  let code = 0;              /* running code value */
  let bits;                  /* bit index */
  let n;                     /* code index */

  /* The distribution counts are first used to generate the code values
   * without bit reversal.
   */
  for (bits = 1; bits <= MAX_BITS; bits++) {
    code = (code + bl_count[bits - 1]) << 1;
    next_code[bits] = code;
  }
  /* Check that the bit counts in bl_count are consistent. The last code
   * must be all ones.
   */
  //Assert (code + bl_count[MAX_BITS]-1 == (1<<MAX_BITS)-1,
  //        "inconsistent bit counts");
  //Tracev((stderr,"\ngen_codes: max_code %d ", max_code));

  for (n = 0;  n <= max_code; n++) {
    let len = tree[n * 2 + 1]/*.Len*/;
    if (len === 0) { continue; }
    /* Now reverse the bits */
    tree[n * 2]/*.Code*/ = bi_reverse(next_code[len]++, len);

    //Tracecv(tree != static_ltree, (stderr,"\nn %3d %c l %2d c %4x (%x) ",
    //     n, (isgraph(n) ? n : ' '), len, tree[n].Code, next_code[len]-1));
  }
};


/* ===========================================================================
 * Initialize the various 'constant' tables.
 */
const tr_static_init = () => {

  let n;        /* iterates over tree elements */
  let bits;     /* bit counter */
  let length;   /* length value */
  let code;     /* code value */
  let dist;     /* distance index */
  const bl_count = new Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  // do check in _tr_init()
  //if (static_init_done) return;

  /* For some embedded targets, global variables are not initialized: */
/*#ifdef NO_INIT_GLOBAL_POINTERS
  static_l_desc.static_tree = static_ltree;
  static_l_desc.extra_bits = extra_lbits;
  static_d_desc.static_tree = static_dtree;
  static_d_desc.extra_bits = extra_dbits;
  static_bl_desc.extra_bits = extra_blbits;
#endif*/

  /* Initialize the mapping length (0..255) -> length code (0..28) */
  length = 0;
  for (code = 0; code < LENGTH_CODES - 1; code++) {
    base_length[code] = length;
    for (n = 0; n < (1 << extra_lbits[code]); n++) {
      _length_code[length++] = code;
    }
  }
  //Assert (length == 256, "tr_static_init: length != 256");
  /* Note that the length 255 (match length 258) can be represented
   * in two different ways: code 284 + 5 bits or code 285, so we
   * overwrite length_code[255] to use the best encoding:
   */
  _length_code[length - 1] = code;

  /* Initialize the mapping dist (0..32K) -> dist code (0..29) */
  dist = 0;
  for (code = 0; code < 16; code++) {
    base_dist[code] = dist;
    for (n = 0; n < (1 << extra_dbits[code]); n++) {
      _dist_code[dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: dist != 256");
  dist >>= 7; /* from now on, all distances are divided by 128 */
  for (; code < D_CODES; code++) {
    base_dist[code] = dist << 7;
    for (n = 0; n < (1 << (extra_dbits[code] - 7)); n++) {
      _dist_code[256 + dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: 256+dist != 512");

  /* Construct the codes of the static literal tree */
  for (bits = 0; bits <= MAX_BITS; bits++) {
    bl_count[bits] = 0;
  }

  n = 0;
  while (n <= 143) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  while (n <= 255) {
    static_ltree[n * 2 + 1]/*.Len*/ = 9;
    n++;
    bl_count[9]++;
  }
  while (n <= 279) {
    static_ltree[n * 2 + 1]/*.Len*/ = 7;
    n++;
    bl_count[7]++;
  }
  while (n <= 287) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  /* Codes 286 and 287 do not exist, but we must include them in the
   * tree construction to get a canonical Huffman tree (longest code
   * all ones)
   */
  gen_codes(static_ltree, L_CODES + 1, bl_count);

  /* The static distance tree is trivial: */
  for (n = 0; n < D_CODES; n++) {
    static_dtree[n * 2 + 1]/*.Len*/ = 5;
    static_dtree[n * 2]/*.Code*/ = bi_reverse(n, 5);
  }

  // Now data ready and we can init static trees
  static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
  static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0,          D_CODES, MAX_BITS);
  static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0,         BL_CODES, MAX_BL_BITS);

  //static_init_done = true;
};


/* ===========================================================================
 * Initialize a new block.
 */
const init_block = (s) => {

  let n; /* iterates over tree elements */

  /* Initialize the trees. */
  for (n = 0; n < L_CODES;  n++) { s.dyn_ltree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < D_CODES;  n++) { s.dyn_dtree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < BL_CODES; n++) { s.bl_tree[n * 2]/*.Freq*/ = 0; }

  s.dyn_ltree[END_BLOCK * 2]/*.Freq*/ = 1;
  s.opt_len = s.static_len = 0;
  s.sym_next = s.matches = 0;
};


/* ===========================================================================
 * Flush the bit buffer and align the output on a byte boundary
 */
const bi_windup = (s) =>
{
  if (s.bi_valid > 8) {
    put_short(s, s.bi_buf);
  } else if (s.bi_valid > 0) {
    //put_byte(s, (Byte)s->bi_buf);
    s.pending_buf[s.pending++] = s.bi_buf;
  }
  s.bi_buf = 0;
  s.bi_valid = 0;
};

/* ===========================================================================
 * Compares to subtrees, using the tree depth as tie breaker when
 * the subtrees have equal frequency. This minimizes the worst case length.
 */
const smaller = (tree, n, m, depth) => {

  const _n2 = n * 2;
  const _m2 = m * 2;
  return (tree[_n2]/*.Freq*/ < tree[_m2]/*.Freq*/ ||
         (tree[_n2]/*.Freq*/ === tree[_m2]/*.Freq*/ && depth[n] <= depth[m]));
};

/* ===========================================================================
 * Restore the heap property by moving down the tree starting at node k,
 * exchanging a node with the smallest of its two sons if necessary, stopping
 * when the heap property is re-established (each father smaller than its
 * two sons).
 */
const pqdownheap = (s, tree, k) => {
//    deflate_state *s;
//    ct_data *tree;  /* the tree to restore */
//    int k;               /* node to move down */

  const v = s.heap[k];
  let j = k << 1;  /* left son of k */
  while (j <= s.heap_len) {
    /* Set j to the smallest of the two sons: */
    if (j < s.heap_len &&
      smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
      j++;
    }
    /* Exit if v is smaller than both sons */
    if (smaller(tree, v, s.heap[j], s.depth)) { break; }

    /* Exchange v with the smallest son */
    s.heap[k] = s.heap[j];
    k = j;

    /* And continue down the tree, setting j to the left son of k */
    j <<= 1;
  }
  s.heap[k] = v;
};


// inlined manually
// const SMALLEST = 1;

/* ===========================================================================
 * Send the block data compressed using the given Huffman trees
 */
const compress_block = (s, ltree, dtree) => {
//    deflate_state *s;
//    const ct_data *ltree; /* literal tree */
//    const ct_data *dtree; /* distance tree */

  let dist;           /* distance of matched string */
  let lc;             /* match length or unmatched char (if dist == 0) */
  let sx = 0;         /* running index in sym_buf */
  let code;           /* the code to send */
  let extra;          /* number of extra bits to send */

  if (s.sym_next !== 0) {
    do {
      dist = s.pending_buf[s.sym_buf + sx++] & 0xff;
      dist += (s.pending_buf[s.sym_buf + sx++] & 0xff) << 8;
      lc = s.pending_buf[s.sym_buf + sx++];
      if (dist === 0) {
        send_code(s, lc, ltree); /* send a literal byte */
        //Tracecv(isgraph(lc), (stderr," '%c' ", lc));
      } else {
        /* Here, lc is the match length - MIN_MATCH */
        code = _length_code[lc];
        send_code(s, code + LITERALS + 1, ltree); /* send the length code */
        extra = extra_lbits[code];
        if (extra !== 0) {
          lc -= base_length[code];
          send_bits(s, lc, extra);       /* send the extra length bits */
        }
        dist--; /* dist is now the match distance - 1 */
        code = d_code(dist);
        //Assert (code < D_CODES, "bad d_code");

        send_code(s, code, dtree);       /* send the distance code */
        extra = extra_dbits[code];
        if (extra !== 0) {
          dist -= base_dist[code];
          send_bits(s, dist, extra);   /* send the extra distance bits */
        }
      } /* literal or match pair ? */

      /* Check that the overlay between pending_buf and sym_buf is ok: */
      //Assert(s->pending < s->lit_bufsize + sx, "pendingBuf overflow");

    } while (sx < s.sym_next);
  }

  send_code(s, END_BLOCK, ltree);
};


/* ===========================================================================
 * Construct one Huffman tree and assigns the code bit strings and lengths.
 * Update the total bit length for the current block.
 * IN assertion: the field freq is set for all tree elements.
 * OUT assertions: the fields len and code are set to the optimal bit length
 *     and corresponding code. The length opt_len is updated; static_len is
 *     also updated if stree is not null. The field max_code is set.
 */
const build_tree = (s, desc) => {
//    deflate_state *s;
//    tree_desc *desc; /* the tree descriptor */

  const tree     = desc.dyn_tree;
  const stree    = desc.stat_desc.static_tree;
  const has_stree = desc.stat_desc.has_stree;
  const elems    = desc.stat_desc.elems;
  let n, m;          /* iterate over heap elements */
  let max_code = -1; /* largest code with non zero frequency */
  let node;          /* new node being created */

  /* Construct the initial heap, with least frequent element in
   * heap[SMALLEST]. The sons of heap[n] are heap[2*n] and heap[2*n+1].
   * heap[0] is not used.
   */
  s.heap_len = 0;
  s.heap_max = HEAP_SIZE;

  for (n = 0; n < elems; n++) {
    if (tree[n * 2]/*.Freq*/ !== 0) {
      s.heap[++s.heap_len] = max_code = n;
      s.depth[n] = 0;

    } else {
      tree[n * 2 + 1]/*.Len*/ = 0;
    }
  }

  /* The pkzip format requires that at least one distance code exists,
   * and that at least one bit should be sent even if there is only one
   * possible code. So to avoid special checks later on we force at least
   * two codes of non zero frequency.
   */
  while (s.heap_len < 2) {
    node = s.heap[++s.heap_len] = (max_code < 2 ? ++max_code : 0);
    tree[node * 2]/*.Freq*/ = 1;
    s.depth[node] = 0;
    s.opt_len--;

    if (has_stree) {
      s.static_len -= stree[node * 2 + 1]/*.Len*/;
    }
    /* node is 0 or 1 so it does not have extra bits */
  }
  desc.max_code = max_code;

  /* The elements heap[heap_len/2+1 .. heap_len] are leaves of the tree,
   * establish sub-heaps of increasing lengths:
   */
  for (n = (s.heap_len >> 1/*int /2*/); n >= 1; n--) { pqdownheap(s, tree, n); }

  /* Construct the Huffman tree by repeatedly combining the least two
   * frequent nodes.
   */
  node = elems;              /* next internal node of the tree */
  do {
    //pqremove(s, tree, n);  /* n = node of least frequency */
    /*** pqremove ***/
    n = s.heap[1/*SMALLEST*/];
    s.heap[1/*SMALLEST*/] = s.heap[s.heap_len--];
    pqdownheap(s, tree, 1/*SMALLEST*/);
    /***/

    m = s.heap[1/*SMALLEST*/]; /* m = node of next least frequency */

    s.heap[--s.heap_max] = n; /* keep the nodes sorted by frequency */
    s.heap[--s.heap_max] = m;

    /* Create a new node father of n and m */
    tree[node * 2]/*.Freq*/ = tree[n * 2]/*.Freq*/ + tree[m * 2]/*.Freq*/;
    s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
    tree[n * 2 + 1]/*.Dad*/ = tree[m * 2 + 1]/*.Dad*/ = node;

    /* and insert the new node in the heap */
    s.heap[1/*SMALLEST*/] = node++;
    pqdownheap(s, tree, 1/*SMALLEST*/);

  } while (s.heap_len >= 2);

  s.heap[--s.heap_max] = s.heap[1/*SMALLEST*/];

  /* At this point, the fields freq and dad are set. We can now
   * generate the bit lengths.
   */
  gen_bitlen(s, desc);

  /* The field len is now set, we can generate the bit codes */
  gen_codes(tree, max_code, s.bl_count);
};


/* ===========================================================================
 * Scan a literal or distance tree to determine the frequencies of the codes
 * in the bit length tree.
 */
const scan_tree = (s, tree, max_code) => {
//    deflate_state *s;
//    ct_data *tree;   /* the tree to be scanned */
//    int max_code;    /* and its largest code of non zero frequency */

  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }
  tree[(max_code + 1) * 2 + 1]/*.Len*/ = 0xffff; /* guard */

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      s.bl_tree[curlen * 2]/*.Freq*/ += count;

    } else if (curlen !== 0) {

      if (curlen !== prevlen) { s.bl_tree[curlen * 2]/*.Freq*/++; }
      s.bl_tree[REP_3_6 * 2]/*.Freq*/++;

    } else if (count <= 10) {
      s.bl_tree[REPZ_3_10 * 2]/*.Freq*/++;

    } else {
      s.bl_tree[REPZ_11_138 * 2]/*.Freq*/++;
    }

    count = 0;
    prevlen = curlen;

    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Send a literal or distance tree in compressed form, using the codes in
 * bl_tree.
 */
const send_tree = (s, tree, max_code) => {
//    deflate_state *s;
//    ct_data *tree; /* the tree to be scanned */
//    int max_code;       /* and its largest code of non zero frequency */

  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  /* tree[max_code+1].Len = -1; */  /* guard already set */
  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      do { send_code(s, curlen, s.bl_tree); } while (--count !== 0);

    } else if (curlen !== 0) {
      if (curlen !== prevlen) {
        send_code(s, curlen, s.bl_tree);
        count--;
      }
      //Assert(count >= 3 && count <= 6, " 3_6?");
      send_code(s, REP_3_6, s.bl_tree);
      send_bits(s, count - 3, 2);

    } else if (count <= 10) {
      send_code(s, REPZ_3_10, s.bl_tree);
      send_bits(s, count - 3, 3);

    } else {
      send_code(s, REPZ_11_138, s.bl_tree);
      send_bits(s, count - 11, 7);
    }

    count = 0;
    prevlen = curlen;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Construct the Huffman tree for the bit lengths and return the index in
 * bl_order of the last bit length code to send.
 */
const build_bl_tree = (s) => {

  let max_blindex;  /* index of last bit length code of non zero freq */

  /* Determine the bit length frequencies for literal and distance trees */
  scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
  scan_tree(s, s.dyn_dtree, s.d_desc.max_code);

  /* Build the bit length tree: */
  build_tree(s, s.bl_desc);
  /* opt_len now includes the length of the tree representations, except
   * the lengths of the bit lengths codes and the 5+5+4 bits for the counts.
   */

  /* Determine the number of bit length codes to send. The pkzip format
   * requires that at least 4 bit length codes be sent. (appnote.txt says
   * 3 but the actual value used is 4.)
   */
  for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
    if (s.bl_tree[bl_order[max_blindex] * 2 + 1]/*.Len*/ !== 0) {
      break;
    }
  }
  /* Update opt_len to include the bit length tree and counts */
  s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
  //Tracev((stderr, "\ndyn trees: dyn %ld, stat %ld",
  //        s->opt_len, s->static_len));

  return max_blindex;
};


/* ===========================================================================
 * Send the header for a block using dynamic Huffman trees: the counts, the
 * lengths of the bit length codes, the literal tree and the distance tree.
 * IN assertion: lcodes >= 257, dcodes >= 1, blcodes >= 4.
 */
const send_all_trees = (s, lcodes, dcodes, blcodes) => {
//    deflate_state *s;
//    int lcodes, dcodes, blcodes; /* number of codes for each tree */

  let rank;                    /* index in bl_order */

  //Assert (lcodes >= 257 && dcodes >= 1 && blcodes >= 4, "not enough codes");
  //Assert (lcodes <= L_CODES && dcodes <= D_CODES && blcodes <= BL_CODES,
  //        "too many codes");
  //Tracev((stderr, "\nbl counts: "));
  send_bits(s, lcodes - 257, 5); /* not +255 as stated in appnote.txt */
  send_bits(s, dcodes - 1,   5);
  send_bits(s, blcodes - 4,  4); /* not -3 as stated in appnote.txt */
  for (rank = 0; rank < blcodes; rank++) {
    //Tracev((stderr, "\nbl code %2d ", bl_order[rank]));
    send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1]/*.Len*/, 3);
  }
  //Tracev((stderr, "\nbl tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_ltree, lcodes - 1); /* literal tree */
  //Tracev((stderr, "\nlit tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_dtree, dcodes - 1); /* distance tree */
  //Tracev((stderr, "\ndist tree: sent %ld", s->bits_sent));
};


/* ===========================================================================
 * Check if the data type is TEXT or BINARY, using the following algorithm:
 * - TEXT if the two conditions below are satisfied:
 *    a) There are no non-portable control characters belonging to the
 *       "block list" (0..6, 14..25, 28..31).
 *    b) There is at least one printable character belonging to the
 *       "allow list" (9 {TAB}, 10 {LF}, 13 {CR}, 32..255).
 * - BINARY otherwise.
 * - The following partially-portable control characters form a
 *   "gray list" that is ignored in this detection algorithm:
 *   (7 {BEL}, 8 {BS}, 11 {VT}, 12 {FF}, 26 {SUB}, 27 {ESC}).
 * IN assertion: the fields Freq of dyn_ltree are set.
 */
const detect_data_type = (s) => {
  /* block_mask is the bit mask of block-listed bytes
   * set bits 0..6, 14..25, and 28..31
   * 0xf3ffc07f = binary 11110011111111111100000001111111
   */
  let block_mask = 0xf3ffc07f;
  let n;

  /* Check for non-textual ("block-listed") bytes. */
  for (n = 0; n <= 31; n++, block_mask >>>= 1) {
    if ((block_mask & 1) && (s.dyn_ltree[n * 2]/*.Freq*/ !== 0)) {
      return Z_BINARY;
    }
  }

  /* Check for textual ("allow-listed") bytes. */
  if (s.dyn_ltree[9 * 2]/*.Freq*/ !== 0 || s.dyn_ltree[10 * 2]/*.Freq*/ !== 0 ||
      s.dyn_ltree[13 * 2]/*.Freq*/ !== 0) {
    return Z_TEXT;
  }
  for (n = 32; n < LITERALS; n++) {
    if (s.dyn_ltree[n * 2]/*.Freq*/ !== 0) {
      return Z_TEXT;
    }
  }

  /* There are no "block-listed" or "allow-listed" bytes:
   * this stream either is empty or has tolerated ("gray-listed") bytes only.
   */
  return Z_BINARY;
};


let static_init_done = false;

/* ===========================================================================
 * Initialize the tree data structures for a new zlib stream.
 */
const _tr_init = (s) =>
{

  if (!static_init_done) {
    tr_static_init();
    static_init_done = true;
  }

  s.l_desc  = new TreeDesc(s.dyn_ltree, static_l_desc);
  s.d_desc  = new TreeDesc(s.dyn_dtree, static_d_desc);
  s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);

  s.bi_buf = 0;
  s.bi_valid = 0;

  /* Initialize the first block of the first file: */
  init_block(s);
};


/* ===========================================================================
 * Send a stored block
 */
const _tr_stored_block = (s, buf, stored_len, last) => {
//DeflateState *s;
//charf *buf;       /* input block */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */

  send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);    /* send block type */
  bi_windup(s);        /* align on byte boundary */
  put_short(s, stored_len);
  put_short(s, ~stored_len);
  if (stored_len) {
    s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
  }
  s.pending += stored_len;
};


/* ===========================================================================
 * Send one empty static block to give enough lookahead for inflate.
 * This takes 10 bits, of which 7 may remain in the bit buffer.
 */
const _tr_align = (s) => {
  send_bits(s, STATIC_TREES << 1, 3);
  send_code(s, END_BLOCK, static_ltree);
  bi_flush(s);
};


/* ===========================================================================
 * Determine the best encoding for the current block: dynamic trees, static
 * trees or store, and write out the encoded block.
 */
const _tr_flush_block = (s, buf, stored_len, last) => {
//DeflateState *s;
//charf *buf;       /* input block, or NULL if too old */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */

  let opt_lenb, static_lenb;  /* opt_len and static_len in bytes */
  let max_blindex = 0;        /* index of last bit length code of non zero freq */

  /* Build the Huffman trees unless a stored block is forced */
  if (s.level > 0) {

    /* Check if the file is binary or text */
    if (s.strm.data_type === Z_UNKNOWN) {
      s.strm.data_type = detect_data_type(s);
    }

    /* Construct the literal and distance trees */
    build_tree(s, s.l_desc);
    // Tracev((stderr, "\nlit data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));

    build_tree(s, s.d_desc);
    // Tracev((stderr, "\ndist data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));
    /* At this point, opt_len and static_len are the total bit lengths of
     * the compressed block data, excluding the tree representations.
     */

    /* Build the bit length tree for the above two trees, and get the index
     * in bl_order of the last bit length code to send.
     */
    max_blindex = build_bl_tree(s);

    /* Determine the best encoding. Compute the block lengths in bytes. */
    opt_lenb = (s.opt_len + 3 + 7) >>> 3;
    static_lenb = (s.static_len + 3 + 7) >>> 3;

    // Tracev((stderr, "\nopt %lu(%lu) stat %lu(%lu) stored %lu lit %u ",
    //        opt_lenb, s->opt_len, static_lenb, s->static_len, stored_len,
    //        s->sym_next / 3));

    if (static_lenb <= opt_lenb) { opt_lenb = static_lenb; }

  } else {
    // Assert(buf != (char*)0, "lost buf");
    opt_lenb = static_lenb = stored_len + 5; /* force a stored block */
  }

  if ((stored_len + 4 <= opt_lenb) && (buf !== -1)) {
    /* 4: two words for the lengths */

    /* The test buf != NULL is only necessary if LIT_BUFSIZE > WSIZE.
     * Otherwise we can't have processed more than WSIZE input bytes since
     * the last block flush, because compression would have been
     * successful. If LIT_BUFSIZE <= WSIZE, it is never too late to
     * transform a block into a stored block.
     */
    _tr_stored_block(s, buf, stored_len, last);

  } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {

    send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
    compress_block(s, static_ltree, static_dtree);

  } else {
    send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
    send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
    compress_block(s, s.dyn_ltree, s.dyn_dtree);
  }
  // Assert (s->compressed_len == s->bits_sent, "bad compressed size");
  /* The above check is made mod 2^32, for files larger than 512 MB
   * and uLong implemented on 32 bits.
   */
  init_block(s);

  if (last) {
    bi_windup(s);
  }
  // Tracev((stderr,"\ncomprlen %lu(%lu) ", s->compressed_len>>3,
  //       s->compressed_len-7*last));
};

/* ===========================================================================
 * Save the match info and tally the frequency counts. Return true if
 * the current block must be flushed.
 */
const _tr_tally = (s, dist, lc) => {
//    deflate_state *s;
//    unsigned dist;  /* distance of matched string */
//    unsigned lc;    /* match length-MIN_MATCH or unmatched char (if dist==0) */

  s.pending_buf[s.sym_buf + s.sym_next++] = dist;
  s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
  s.pending_buf[s.sym_buf + s.sym_next++] = lc;
  if (dist === 0) {
    /* lc is the unmatched char */
    s.dyn_ltree[lc * 2]/*.Freq*/++;
  } else {
    s.matches++;
    /* Here, lc is the match length - MIN_MATCH */
    dist--;             /* dist = match distance - 1 */
    //Assert((ush)dist < (ush)MAX_DIST(s) &&
    //       (ush)lc <= (ush)(MAX_MATCH-MIN_MATCH) &&
    //       (ush)d_code(dist) < (ush)D_CODES,  "_tr_tally: bad match");

    s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]/*.Freq*/++;
    s.dyn_dtree[d_code(dist) * 2]/*.Freq*/++;
  }

  return (s.sym_next === s.sym_end);
};

module.exports._tr_init  = _tr_init;
module.exports._tr_stored_block = _tr_stored_block;
module.exports._tr_flush_block  = _tr_flush_block;
module.exports._tr_tally = _tr_tally;
module.exports._tr_align = _tr_align;

},{}],43:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function ZStream() {
  /* next input byte */
  this.input = null; // JS specific, because we have no pointers
  this.next_in = 0;
  /* number of bytes available at input */
  this.avail_in = 0;
  /* total number of input bytes read so far */
  this.total_in = 0;
  /* next output byte should be put there */
  this.output = null; // JS specific, because we have no pointers
  this.next_out = 0;
  /* remaining free space at output */
  this.avail_out = 0;
  /* total number of bytes output so far */
  this.total_out = 0;
  /* last error message, NULL if no error */
  this.msg = ''/*Z_NULL*/;
  /* not visible by applications */
  this.state = null;
  /* best guess about the data type: binary or text */
  this.data_type = 2/*Z_UNKNOWN*/;
  /* adler32 value of the uncompressed data */
  this.adler = 0;
}

module.exports = ZStream;

},{}],44:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],45:[function(require,module,exports){
(function (Buffer){(function (){
/*
node-bzip - a pure-javascript Node.JS module for decoding bzip2 data

Copyright (C) 2012 Eli Skeggs

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Adapted from bzip2.js, copyright 2011 antimatter15 (antimatter15@gmail.com).

Based on micro-bunzip by Rob Landley (rob@landley.net).

Based on bzip2 decompression code by Julian R Seward (jseward@acm.org),
which also acknowledges contributions by Mike Burrows, David Wheeler,
Peter Fenwick, Alistair Moffat, Radford Neal, Ian H. Witten,
Robert Sedgewick, and Jon L. Bentley.
*/

var BITMASK = [0x00, 0x01, 0x03, 0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFF];

// offset in bytes
var BitReader = function(stream) {
  this.stream = stream;
  this.bitOffset = 0;
  this.curByte = 0;
  this.hasByte = false;
};

BitReader.prototype._ensureByte = function() {
  if (!this.hasByte) {
    this.curByte = this.stream.readByte();
    this.hasByte = true;
  }
};

// reads bits from the buffer
BitReader.prototype.read = function(bits) {
  var result = 0;
  while (bits > 0) {
    this._ensureByte();
    var remaining = 8 - this.bitOffset;
    // if we're in a byte
    if (bits >= remaining) {
      result <<= remaining;
      result |= BITMASK[remaining] & this.curByte;
      this.hasByte = false;
      this.bitOffset = 0;
      bits -= remaining;
    } else {
      result <<= bits;
      var shift = remaining - bits;
      result |= (this.curByte & (BITMASK[bits] << shift)) >> shift;
      this.bitOffset += bits;
      bits = 0;
    }
  }
  return result;
};

// seek to an arbitrary point in the buffer (expressed in bits)
BitReader.prototype.seek = function(pos) {
  var n_bit = pos % 8;
  var n_byte = (pos - n_bit) / 8;
  this.bitOffset = n_bit;
  this.stream.seek(n_byte);
  this.hasByte = false;
};

// reads 6 bytes worth of data using the read method
BitReader.prototype.pi = function() {
  var buf = new Buffer(6), i;
  for (i = 0; i < buf.length; i++) {
    buf[i] = this.read(8);
  }
  return buf.toString('hex');
};

module.exports = BitReader;

}).call(this)}).call(this,require("buffer").Buffer)
},{"buffer":24}],46:[function(require,module,exports){
/* CRC32, used in Bzip2 implementation.
 * This is a port of CRC32.java from the jbzip2 implementation at
 *   https://code.google.com/p/jbzip2
 * which is:
 *   Copyright (c) 2011 Matthew Francis
 *
 *   Permission is hereby granted, free of charge, to any person
 *   obtaining a copy of this software and associated documentation
 *   files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use,
 *   copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following
 *   conditions:
 *
 *   The above copyright notice and this permission notice shall be
 *   included in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 *   OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 *   HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 *   WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 *   OTHER DEALINGS IN THE SOFTWARE.
 * This JavaScript implementation is:
 *   Copyright (c) 2013 C. Scott Ananian
 * with the same licensing terms as Matthew Francis' original implementation.
 */
module.exports = (function() {

  /**
   * A static CRC lookup table
   */
  var crc32Lookup = new Uint32Array([
    0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9, 0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005,
    0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61, 0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
    0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9, 0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75,
    0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011, 0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
    0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039, 0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5,
    0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81, 0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
    0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49, 0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95,
    0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1, 0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
    0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae, 0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072,
    0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16, 0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
    0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde, 0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02,
    0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066, 0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
    0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e, 0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692,
    0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6, 0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
    0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e, 0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2,
    0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686, 0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
    0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637, 0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb,
    0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f, 0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
    0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47, 0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b,
    0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff, 0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
    0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7, 0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b,
    0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f, 0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
    0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7, 0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b,
    0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f, 0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
    0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640, 0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c,
    0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8, 0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
    0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30, 0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec,
    0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088, 0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
    0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0, 0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c,
    0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18, 0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
    0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0, 0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c,
    0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668, 0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4
  ]);

  var CRC32 = function() {
    /**
     * The current CRC
     */
    var crc = 0xffffffff;

    /**
     * @return The current CRC
     */
    this.getCRC = function() {
      return (~crc) >>> 0; // return an unsigned value
    };

    /**
     * Update the CRC with a single byte
     * @param value The value to update the CRC with
     */
    this.updateCRC = function(value) {
      crc = (crc << 8) ^ crc32Lookup[((crc >>> 24) ^ value) & 0xff];
    };

    /**
     * Update the CRC with a sequence of identical bytes
     * @param value The value to update the CRC with
     * @param count The number of bytes
     */
    this.updateCRCRun = function(value, count) {
      while (count-- > 0) {
        crc = (crc << 8) ^ crc32Lookup[((crc >>> 24) ^ value) & 0xff];
      }
    };
  };
  return CRC32;
})();

},{}],47:[function(require,module,exports){
(function (Buffer){(function (){
/*
seek-bzip - a pure-javascript module for seeking within bzip2 data

Copyright (C) 2013 C. Scott Ananian
Copyright (C) 2012 Eli Skeggs
Copyright (C) 2011 Kevin Kwok

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Adapted from node-bzip, copyright 2012 Eli Skeggs.
Adapted from bzip2.js, copyright 2011 Kevin Kwok (antimatter15@gmail.com).

Based on micro-bunzip by Rob Landley (rob@landley.net).

Based on bzip2 decompression code by Julian R Seward (jseward@acm.org),
which also acknowledges contributions by Mike Burrows, David Wheeler,
Peter Fenwick, Alistair Moffat, Radford Neal, Ian H. Witten,
Robert Sedgewick, and Jon L. Bentley.
*/

var BitReader = require('./bitreader');
var Stream = require('./stream');
var CRC32 = require('./crc32');
var pjson = require('../package.json');

var MAX_HUFCODE_BITS = 20;
var MAX_SYMBOLS = 258;
var SYMBOL_RUNA = 0;
var SYMBOL_RUNB = 1;
var MIN_GROUPS = 2;
var MAX_GROUPS = 6;
var GROUP_SIZE = 50;

var WHOLEPI = "314159265359";
var SQRTPI = "177245385090";

var mtf = function(array, index) {
  var src = array[index], i;
  for (i = index; i > 0; i--) {
    array[i] = array[i-1];
  }
  array[0] = src;
  return src;
};

var Err = {
  OK: 0,
  LAST_BLOCK: -1,
  NOT_BZIP_DATA: -2,
  UNEXPECTED_INPUT_EOF: -3,
  UNEXPECTED_OUTPUT_EOF: -4,
  DATA_ERROR: -5,
  OUT_OF_MEMORY: -6,
  OBSOLETE_INPUT: -7,
  END_OF_BLOCK: -8
};
var ErrorMessages = {};
ErrorMessages[Err.LAST_BLOCK] =            "Bad file checksum";
ErrorMessages[Err.NOT_BZIP_DATA] =         "Not bzip data";
ErrorMessages[Err.UNEXPECTED_INPUT_EOF] =  "Unexpected input EOF";
ErrorMessages[Err.UNEXPECTED_OUTPUT_EOF] = "Unexpected output EOF";
ErrorMessages[Err.DATA_ERROR] =            "Data error";
ErrorMessages[Err.OUT_OF_MEMORY] =         "Out of memory";
ErrorMessages[Err.OBSOLETE_INPUT] = "Obsolete (pre 0.9.5) bzip format not supported.";

var _throw = function(status, optDetail) {
  var msg = ErrorMessages[status] || 'unknown error';
  if (optDetail) { msg += ': '+optDetail; }
  var e = new TypeError(msg);
  e.errorCode = status;
  throw e;
};

var Bunzip = function(inputStream, outputStream) {
  this.writePos = this.writeCurrent = this.writeCount = 0;

  this._start_bunzip(inputStream, outputStream);
};
Bunzip.prototype._init_block = function() {
  var moreBlocks = this._get_next_block();
  if ( !moreBlocks ) {
    this.writeCount = -1;
    return false; /* no more blocks */
  }
  this.blockCRC = new CRC32();
  return true;
};
/* XXX micro-bunzip uses (inputStream, inputBuffer, len) as arguments */
Bunzip.prototype._start_bunzip = function(inputStream, outputStream) {
  /* Ensure that file starts with "BZh['1'-'9']." */
  var buf = new Buffer(4);
  if (inputStream.read(buf, 0, 4) !== 4 ||
      String.fromCharCode(buf[0], buf[1], buf[2]) !== 'BZh')
    _throw(Err.NOT_BZIP_DATA, 'bad magic');

  var level = buf[3] - 0x30;
  if (level < 1 || level > 9)
    _throw(Err.NOT_BZIP_DATA, 'level out of range');

  this.reader = new BitReader(inputStream);

  /* Fourth byte (ascii '1'-'9'), indicates block size in units of 100k of
     uncompressed data.  Allocate intermediate buffer for block. */
  this.dbufSize = 100000 * level;
  this.nextoutput = 0;
  this.outputStream = outputStream;
  this.streamCRC = 0;
};
Bunzip.prototype._get_next_block = function() {
  var i, j, k;
  var reader = this.reader;
  // this is get_next_block() function from micro-bunzip:
  /* Read in header signature and CRC, then validate signature.
     (last block signature means CRC is for whole file, return now) */
  var h = reader.pi();
  if (h === SQRTPI) { // last block
    return false; /* no more blocks */
  }
  if (h !== WHOLEPI)
    _throw(Err.NOT_BZIP_DATA);
  this.targetBlockCRC = reader.read(32) >>> 0; // (convert to unsigned)
  this.streamCRC = (this.targetBlockCRC ^
                    ((this.streamCRC << 1) | (this.streamCRC>>>31))) >>> 0;
  /* We can add support for blockRandomised if anybody complains.  There was
     some code for this in busybox 1.0.0-pre3, but nobody ever noticed that
     it didn't actually work. */
  if (reader.read(1))
    _throw(Err.OBSOLETE_INPUT);
  var origPointer = reader.read(24);
  if (origPointer > this.dbufSize)
    _throw(Err.DATA_ERROR, 'initial position out of bounds');
  /* mapping table: if some byte values are never used (encoding things
     like ascii text), the compression code removes the gaps to have fewer
     symbols to deal with, and writes a sparse bitfield indicating which
     values were present.  We make a translation table to convert the symbols
     back to the corresponding bytes. */
  var t = reader.read(16);
  var symToByte = new Buffer(256), symTotal = 0;
  for (i = 0; i < 16; i++) {
    if (t & (1 << (0xF - i))) {
      var o = i * 16;
      k = reader.read(16);
      for (j = 0; j < 16; j++)
        if (k & (1 << (0xF - j)))
          symToByte[symTotal++] = o + j;
    }
  }

  /* How many different huffman coding groups does this block use? */
  var groupCount = reader.read(3);
  if (groupCount < MIN_GROUPS || groupCount > MAX_GROUPS)
    _throw(Err.DATA_ERROR);
  /* nSelectors: Every GROUP_SIZE many symbols we select a new huffman coding
     group.  Read in the group selector list, which is stored as MTF encoded
     bit runs.  (MTF=Move To Front, as each value is used it's moved to the
     start of the list.) */
  var nSelectors = reader.read(15);
  if (nSelectors === 0)
    _throw(Err.DATA_ERROR);

  var mtfSymbol = new Buffer(256);
  for (i = 0; i < groupCount; i++)
    mtfSymbol[i] = i;

  var selectors = new Buffer(nSelectors); // was 32768...

  for (i = 0; i < nSelectors; i++) {
    /* Get next value */
    for (j = 0; reader.read(1); j++)
      if (j >= groupCount) _throw(Err.DATA_ERROR);
    /* Decode MTF to get the next selector */
    selectors[i] = mtf(mtfSymbol, j);
  }

  /* Read the huffman coding tables for each group, which code for symTotal
     literal symbols, plus two run symbols (RUNA, RUNB) */
  var symCount = symTotal + 2;
  var groups = [], hufGroup;
  for (j = 0; j < groupCount; j++) {
    var length = new Buffer(symCount), temp = new Uint16Array(MAX_HUFCODE_BITS + 1);
    /* Read huffman code lengths for each symbol.  They're stored in
       a way similar to mtf; record a starting value for the first symbol,
       and an offset from the previous value for everys symbol after that. */
    t = reader.read(5); // lengths
    for (i = 0; i < symCount; i++) {
      for (;;) {
        if (t < 1 || t > MAX_HUFCODE_BITS) _throw(Err.DATA_ERROR);
        /* If first bit is 0, stop.  Else second bit indicates whether
           to increment or decrement the value. */
        if(!reader.read(1))
          break;
        if(!reader.read(1))
          t++;
        else
          t--;
      }
      length[i] = t;
    }

    /* Find largest and smallest lengths in this group */
    var minLen,  maxLen;
    minLen = maxLen = length[0];
    for (i = 1; i < symCount; i++) {
      if (length[i] > maxLen)
        maxLen = length[i];
      else if (length[i] < minLen)
        minLen = length[i];
    }

    /* Calculate permute[], base[], and limit[] tables from length[].
     *
     * permute[] is the lookup table for converting huffman coded symbols
     * into decoded symbols.  base[] is the amount to subtract from the
     * value of a huffman symbol of a given length when using permute[].
     *
     * limit[] indicates the largest numerical value a symbol with a given
     * number of bits can have.  This is how the huffman codes can vary in
     * length: each code with a value>limit[length] needs another bit.
     */
    hufGroup = {};
    groups.push(hufGroup);
    hufGroup.permute = new Uint16Array(MAX_SYMBOLS);
    hufGroup.limit = new Uint32Array(MAX_HUFCODE_BITS + 2);
    hufGroup.base = new Uint32Array(MAX_HUFCODE_BITS + 1);
    hufGroup.minLen = minLen;
    hufGroup.maxLen = maxLen;
    /* Calculate permute[].  Concurently, initialize temp[] and limit[]. */
    var pp = 0;
    for (i = minLen; i <= maxLen; i++) {
      temp[i] = hufGroup.limit[i] = 0;
      for (t = 0; t < symCount; t++)
        if (length[t] === i)
          hufGroup.permute[pp++] = t;
    }
    /* Count symbols coded for at each bit length */
    for (i = 0; i < symCount; i++)
      temp[length[i]]++;
    /* Calculate limit[] (the largest symbol-coding value at each bit
     * length, which is (previous limit<<1)+symbols at this level), and
     * base[] (number of symbols to ignore at each bit length, which is
     * limit minus the cumulative count of symbols coded for already). */
    pp = t = 0;
    for (i = minLen; i < maxLen; i++) {
      pp += temp[i];
      /* We read the largest possible symbol size and then unget bits
         after determining how many we need, and those extra bits could
         be set to anything.  (They're noise from future symbols.)  At
         each level we're really only interested in the first few bits,
         so here we set all the trailing to-be-ignored bits to 1 so they
         don't affect the value>limit[length] comparison. */
      hufGroup.limit[i] = pp - 1;
      pp <<= 1;
      t += temp[i];
      hufGroup.base[i + 1] = pp - t;
    }
    hufGroup.limit[maxLen + 1] = Number.MAX_VALUE; /* Sentinal value for reading next sym. */
    hufGroup.limit[maxLen] = pp + temp[maxLen] - 1;
    hufGroup.base[minLen] = 0;
  }
  /* We've finished reading and digesting the block header.  Now read this
     block's huffman coded symbols from the file and undo the huffman coding
     and run length encoding, saving the result into dbuf[dbufCount++]=uc */

  /* Initialize symbol occurrence counters and symbol Move To Front table */
  var byteCount = new Uint32Array(256);
  for (i = 0; i < 256; i++)
    mtfSymbol[i] = i;
  /* Loop through compressed symbols. */
  var runPos = 0, dbufCount = 0, selector = 0, uc;
  var dbuf = this.dbuf = new Uint32Array(this.dbufSize);
  symCount = 0;
  for (;;) {
    /* Determine which huffman coding group to use. */
    if (!(symCount--)) {
      symCount = GROUP_SIZE - 1;
      if (selector >= nSelectors) { _throw(Err.DATA_ERROR); }
      hufGroup = groups[selectors[selector++]];
    }
    /* Read next huffman-coded symbol. */
    i = hufGroup.minLen;
    j = reader.read(i);
    for (;;i++) {
      if (i > hufGroup.maxLen) { _throw(Err.DATA_ERROR); }
      if (j <= hufGroup.limit[i])
        break;
      j = (j << 1) | reader.read(1);
    }
    /* Huffman decode value to get nextSym (with bounds checking) */
    j -= hufGroup.base[i];
    if (j < 0 || j >= MAX_SYMBOLS) { _throw(Err.DATA_ERROR); }
    var nextSym = hufGroup.permute[j];
    /* We have now decoded the symbol, which indicates either a new literal
       byte, or a repeated run of the most recent literal byte.  First,
       check if nextSym indicates a repeated run, and if so loop collecting
       how many times to repeat the last literal. */
    if (nextSym === SYMBOL_RUNA || nextSym === SYMBOL_RUNB) {
      /* If this is the start of a new run, zero out counter */
      if (!runPos){
        runPos = 1;
        t = 0;
      }
      /* Neat trick that saves 1 symbol: instead of or-ing 0 or 1 at
         each bit position, add 1 or 2 instead.  For example,
         1011 is 1<<0 + 1<<1 + 2<<2.  1010 is 2<<0 + 2<<1 + 1<<2.
         You can make any bit pattern that way using 1 less symbol than
         the basic or 0/1 method (except all bits 0, which would use no
         symbols, but a run of length 0 doesn't mean anything in this
         context).  Thus space is saved. */
      if (nextSym === SYMBOL_RUNA)
        t += runPos;
      else
        t += 2 * runPos;
      runPos <<= 1;
      continue;
    }
    /* When we hit the first non-run symbol after a run, we now know
       how many times to repeat the last literal, so append that many
       copies to our buffer of decoded symbols (dbuf) now.  (The last
       literal used is the one at the head of the mtfSymbol array.) */
    if (runPos){
      runPos = 0;
      if (dbufCount + t > this.dbufSize) { _throw(Err.DATA_ERROR); }
      uc = symToByte[mtfSymbol[0]];
      byteCount[uc] += t;
      while (t--)
        dbuf[dbufCount++] = uc;
    }
    /* Is this the terminating symbol? */
    if (nextSym > symTotal)
      break;
    /* At this point, nextSym indicates a new literal character.  Subtract
       one to get the position in the MTF array at which this literal is
       currently to be found.  (Note that the result can't be -1 or 0,
       because 0 and 1 are RUNA and RUNB.  But another instance of the
       first symbol in the mtf array, position 0, would have been handled
       as part of a run above.  Therefore 1 unused mtf position minus
       2 non-literal nextSym values equals -1.) */
    if (dbufCount >= this.dbufSize) { _throw(Err.DATA_ERROR); }
    i = nextSym - 1;
    uc = mtf(mtfSymbol, i);
    uc = symToByte[uc];
    /* We have our literal byte.  Save it into dbuf. */
    byteCount[uc]++;
    dbuf[dbufCount++] = uc;
  }
  /* At this point, we've read all the huffman-coded symbols (and repeated
     runs) for this block from the input stream, and decoded them into the
     intermediate buffer.  There are dbufCount many decoded bytes in dbuf[].
     Now undo the Burrows-Wheeler transform on dbuf.
     See http://dogma.net/markn/articles/bwt/bwt.htm
  */
  if (origPointer < 0 || origPointer >= dbufCount) { _throw(Err.DATA_ERROR); }
  /* Turn byteCount into cumulative occurrence counts of 0 to n-1. */
  j = 0;
  for (i = 0; i < 256; i++) {
    k = j + byteCount[i];
    byteCount[i] = j;
    j = k;
  }
  /* Figure out what order dbuf would be in if we sorted it. */
  for (i = 0; i < dbufCount; i++) {
    uc = dbuf[i] & 0xff;
    dbuf[byteCount[uc]] |= (i << 8);
    byteCount[uc]++;
  }
  /* Decode first byte by hand to initialize "previous" byte.  Note that it
     doesn't get output, and if the first three characters are identical
     it doesn't qualify as a run (hence writeRunCountdown=5). */
  var pos = 0, current = 0, run = 0;
  if (dbufCount) {
    pos = dbuf[origPointer];
    current = (pos & 0xff);
    pos >>= 8;
    run = -1;
  }
  this.writePos = pos;
  this.writeCurrent = current;
  this.writeCount = dbufCount;
  this.writeRun = run;

  return true; /* more blocks to come */
};
/* Undo burrows-wheeler transform on intermediate buffer to produce output.
   If start_bunzip was initialized with out_fd=-1, then up to len bytes of
   data are written to outbuf.  Return value is number of bytes written or
   error (all errors are negative numbers).  If out_fd!=-1, outbuf and len
   are ignored, data is written to out_fd and return is RETVAL_OK or error.
*/
Bunzip.prototype._read_bunzip = function(outputBuffer, len) {
    var copies, previous, outbyte;
    /* james@jamestaylor.org: writeCount goes to -1 when the buffer is fully
       decoded, which results in this returning RETVAL_LAST_BLOCK, also
       equal to -1... Confusing, I'm returning 0 here to indicate no
       bytes written into the buffer */
  if (this.writeCount < 0) { return 0; }

  var gotcount = 0;
  var dbuf = this.dbuf, pos = this.writePos, current = this.writeCurrent;
  var dbufCount = this.writeCount, outputsize = this.outputsize;
  var run = this.writeRun;

  while (dbufCount) {
    dbufCount--;
    previous = current;
    pos = dbuf[pos];
    current = pos & 0xff;
    pos >>= 8;
    if (run++ === 3){
      copies = current;
      outbyte = previous;
      current = -1;
    } else {
      copies = 1;
      outbyte = current;
    }
    this.blockCRC.updateCRCRun(outbyte, copies);
    while (copies--) {
      this.outputStream.writeByte(outbyte);
      this.nextoutput++;
    }
    if (current != previous)
      run = 0;
  }
  this.writeCount = dbufCount;
  // check CRC
  if (this.blockCRC.getCRC() !== this.targetBlockCRC) {
    _throw(Err.DATA_ERROR, "Bad block CRC "+
           "(got "+this.blockCRC.getCRC().toString(16)+
           " expected "+this.targetBlockCRC.toString(16)+")");
  }
  return this.nextoutput;
};

var coerceInputStream = function(input) {
  if ('readByte' in input) { return input; }
  var inputStream = new Stream();
  inputStream.pos = 0;
  inputStream.readByte = function() { return input[this.pos++]; };
  inputStream.seek = function(pos) { this.pos = pos; };
  inputStream.eof = function() { return this.pos >= input.length; };
  return inputStream;
};
var coerceOutputStream = function(output) {
  var outputStream = new Stream();
  var resizeOk = true;
  if (output) {
    if (typeof(output)==='number') {
      outputStream.buffer = new Buffer(output);
      resizeOk = false;
    } else if ('writeByte' in output) {
      return output;
    } else {
      outputStream.buffer = output;
      resizeOk = false;
    }
  } else {
    outputStream.buffer = new Buffer(16384);
  }
  outputStream.pos = 0;
  outputStream.writeByte = function(_byte) {
    if (resizeOk && this.pos >= this.buffer.length) {
      var newBuffer = new Buffer(this.buffer.length*2);
      this.buffer.copy(newBuffer);
      this.buffer = newBuffer;
    }
    this.buffer[this.pos++] = _byte;
  };
  outputStream.getBuffer = function() {
    // trim buffer
    if (this.pos !== this.buffer.length) {
      if (!resizeOk)
        throw new TypeError('outputsize does not match decoded input');
      var newBuffer = new Buffer(this.pos);
      this.buffer.copy(newBuffer, 0, 0, this.pos);
      this.buffer = newBuffer;
    }
    return this.buffer;
  };
  outputStream._coerced = true;
  return outputStream;
};

/* Static helper functions */
Bunzip.Err = Err;
// 'input' can be a stream or a buffer
// 'output' can be a stream or a buffer or a number (buffer size)
Bunzip.decode = function(input, output, multistream) {
  // make a stream from a buffer, if necessary
  var inputStream = coerceInputStream(input);
  var outputStream = coerceOutputStream(output);

  var bz = new Bunzip(inputStream, outputStream);
  while (true) {
    if ('eof' in inputStream && inputStream.eof()) break;
    if (bz._init_block()) {
      bz._read_bunzip();
    } else {
      var targetStreamCRC = bz.reader.read(32) >>> 0; // (convert to unsigned)
      if (targetStreamCRC !== bz.streamCRC) {
        _throw(Err.DATA_ERROR, "Bad stream CRC "+
               "(got "+bz.streamCRC.toString(16)+
               " expected "+targetStreamCRC.toString(16)+")");
      }
      if (multistream &&
          'eof' in inputStream &&
          !inputStream.eof()) {
        // note that start_bunzip will also resync the bit reader to next byte
        bz._start_bunzip(inputStream, outputStream);
      } else break;
    }
  }
  if ('getBuffer' in outputStream)
    return outputStream.getBuffer();
};
Bunzip.decodeBlock = function(input, pos, output) {
  // make a stream from a buffer, if necessary
  var inputStream = coerceInputStream(input);
  var outputStream = coerceOutputStream(output);
  var bz = new Bunzip(inputStream, outputStream);
  bz.reader.seek(pos);
  /* Fill the decode buffer for the block */
  var moreBlocks = bz._get_next_block();
  if (moreBlocks) {
    /* Init the CRC for writing */
    bz.blockCRC = new CRC32();

    /* Zero this so the current byte from before the seek is not written */
    bz.writeCopies = 0;

    /* Decompress the block and write to stdout */
    bz._read_bunzip();
    // XXX keep writing?
  }
  if ('getBuffer' in outputStream)
    return outputStream.getBuffer();
};
/* Reads bzip2 file from stream or buffer `input`, and invoke
 * `callback(position, size)` once for each bzip2 block,
 * where position gives the starting position (in *bits*)
 * and size gives uncompressed size of the block (in *bytes*). */
Bunzip.table = function(input, callback, multistream) {
  // make a stream from a buffer, if necessary
  var inputStream = new Stream();
  inputStream.delegate = coerceInputStream(input);
  inputStream.pos = 0;
  inputStream.readByte = function() {
    this.pos++;
    return this.delegate.readByte();
  };
  if (inputStream.delegate.eof) {
    inputStream.eof = inputStream.delegate.eof.bind(inputStream.delegate);
  }
  var outputStream = new Stream();
  outputStream.pos = 0;
  outputStream.writeByte = function() { this.pos++; };

  var bz = new Bunzip(inputStream, outputStream);
  var blockSize = bz.dbufSize;
  while (true) {
    if ('eof' in inputStream && inputStream.eof()) break;

    var position = inputStream.pos*8 + bz.reader.bitOffset;
    if (bz.reader.hasByte) { position -= 8; }

    if (bz._init_block()) {
      var start = outputStream.pos;
      bz._read_bunzip();
      callback(position, outputStream.pos - start);
    } else {
      var crc = bz.reader.read(32); // (but we ignore the crc)
      if (multistream &&
          'eof' in inputStream &&
          !inputStream.eof()) {
        // note that start_bunzip will also resync the bit reader to next byte
        bz._start_bunzip(inputStream, outputStream);
        console.assert(bz.dbufSize === blockSize,
                       "shouldn't change block size within multistream file");
      } else break;
    }
  }
};

Bunzip.Stream = Stream;

Bunzip.version = pjson.version;
Bunzip.license = pjson.license;

module.exports = Bunzip;

}).call(this)}).call(this,require("buffer").Buffer)
},{"../package.json":49,"./bitreader":45,"./crc32":46,"./stream":48,"buffer":24}],48:[function(require,module,exports){
/* very simple input/output stream interface */
var Stream = function() {
};

// input streams //////////////
/** Returns the next byte, or -1 for EOF. */
Stream.prototype.readByte = function() {
  throw new Error("abstract method readByte() not implemented");
};
/** Attempts to fill the buffer; returns number of bytes read, or
 *  -1 for EOF. */
Stream.prototype.read = function(buffer, bufOffset, length) {
  var bytesRead = 0;
  while (bytesRead < length) {
    var c = this.readByte();
    if (c < 0) { // EOF
      return (bytesRead===0) ? -1 : bytesRead;
    }
    buffer[bufOffset++] = c;
    bytesRead++;
  }
  return bytesRead;
};
Stream.prototype.seek = function(new_pos) {
  throw new Error("abstract method seek() not implemented");
};

// output streams ///////////
Stream.prototype.writeByte = function(_byte) {
  throw new Error("abstract method readByte() not implemented");
};
Stream.prototype.write = function(buffer, bufOffset, length) {
  var i;
  for (i=0; i<length; i++) {
    this.writeByte(buffer[bufOffset++]);
  }
  return length;
};
Stream.prototype.flush = function() {
};

module.exports = Stream;

},{}],49:[function(require,module,exports){
module.exports={
  "name": "seek-bzip",
  "version": "2.0.0",
  "contributors": [
    "C. Scott Ananian (http://cscott.net)",
    "Eli Skeggs",
    "Kevin Kwok",
    "Rob Landley (http://landley.net)"
  ],
  "description": "a pure-JavaScript Node.JS module for random-access decoding bzip2 data",
  "main": "./lib/index.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/cscott/seek-bzip.git"
  },
  "license": "MIT",
  "bin": {
    "seek-bunzip": "./bin/seek-bunzip",
    "seek-table": "./bin/seek-bzip-table"
  },
  "directories": {
    "test": "test"
  },
  "dependencies": {
    "commander": "^6.0.0"
  },
  "devDependencies": {
    "fibers": "^5.0.0",
    "mocha": "^8.1.0"
  },
  "scripts": {
    "test": "mocha"
  }
}

},{}],50:[function(require,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn, options) {
    var wkey;
    var cacheKeys = Object.keys(cache);

    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        var exp = cache[key].exports;
        // Using babel as a transpiler to use esmodule, the export will always
        // be an object with the default export as a property of it. To ensure
        // the existing api and babel esmodule exports are both supported we
        // check for both
        if (exp === fn || exp && exp.default === fn) {
            wkey = key;
            break;
        }
    }

    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            'function(require,module,exports){' + fn + '(self); }',
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);

    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        'function(require,module,exports){' +
            // try to call default if defined to also support babel esmodule exports
            'var f = require(' + stringify(wkey) + ');' +
            '(f.default ? f.default : f)(self);' +
        '}',
        scache
    ];

    var workerSources = {};
    resolveSources(skey);

    function resolveSources(key) {
        workerSources[key] = true;

        for (var depPath in sources[key][1]) {
            var depKey = sources[key][1][depPath];
            if (!workerSources[depKey]) {
                resolveSources(depKey);
            }
        }
    }

    var src = '(' + bundleFn + ')({'
        + Object.keys(workerSources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;

    var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

    var blob = new Blob([src], { type: 'text/javascript' });
    if (options && options.bare) { return blob; }
    var workerUrl = URL.createObjectURL(blob);
    var worker = new Worker(workerUrl);
    worker.objectURL = workerUrl;
    return worker;
};

},{}]},{},[5])(5)
});
