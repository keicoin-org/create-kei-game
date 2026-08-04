/** Legitimate tiny runtime-media fixtures: structurally valid PNG, GLB, and Ogg Opus bytes. */

import { deflateSync } from 'node:zlib'

const KENNEY_TINY_DUNGEON_SOURCE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAB1JREFUOI1jLLM2+89AAWCiRPOoAaMGjBowmAwAAPZPAgZ7bKDkAAAAAElFTkSuQmCC', 'base64')
const KENNEY_TINY_DUNGEON_LICENCE = Buffer.from('CQ0KDQoJVGlueSBEdW5nZW9uICgxLjApDQoNCglDcmVhdGVkL2Rpc3RyaWJ1dGVkIGJ5IEtlbm5leSAod3d3Lmtlbm5leS5ubCkNCglDcmVhdGlvbiBkYXRlOiAwNS0wNy0yMDIyDQoNCgkJCS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KDQoJTGljZW5zZTogKENyZWF0aXZlIENvbW1vbnMgWmVybywgQ0MwKQ0KCWh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL3B1YmxpY2RvbWFpbi96ZXJvLzEuMC8NCg0KCVRoaXMgY29udGVudCBpcyBmcmVlIHRvIHVzZSBpbiBwZXJzb25hbCwgZWR1Y2F0aW9uYWwgYW5kIGNvbW1lcmNpYWwgcHJvamVjdHMuDQ0KCVN1cHBvcnQgdXMgYnkgY3JlZGl0aW5nIEtlbm5leSBvciB3d3cua2VubmV5Lm5sICh0aGlzIGlzIG5vdCBtYW5kYXRvcnkpDQoNCgkJCS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KDQoJRG9uYXRlOiAgIGh0dHA6Ly9zdXBwb3J0Lmtlbm5leS5ubA0KCVBhdHJlb246ICBodHRwOi8vcGF0cmVvbi5jb20va2VubmV5Lw0KDQoJRm9sbG93IG9uIFR3aXR0ZXIgZm9yIHVwZGF0ZXM6DQoJaHR0cDovL3R3aXR0ZXIuY29tL0tlbm5leU5M', 'base64')
const KENNEY_RPG_AUDIO_LICENCE = Buffer.from('CQ0KDQoJUlBHIEF1ZGlvDQoNCglieSAgS2VubmV5IFZsZXVnZWxzIChLZW5uZXkubmwpDQoNCgkJCS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KDQoJTGljZW5zZSAoQ3JlYXRpdmUgQ29tbW9ucyBaZXJvLCBDQzApDQoJaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvcHVibGljZG9tYWluL3plcm8vMS4wLw0KDQoJWW91IG1heSB1c2UgdGhlc2UgYXNzZXRzIGluIHBlcnNvbmFsIGFuZCBjb21tZXJjaWFsIHByb2plY3RzLg0KCUNyZWRpdCAoS2VubmV5IG9yIHd3dy5rZW5uZXkubmwpIHdvdWxkIGJlIG5pY2UgYnV0IGlzIG5vdCBtYW5kYXRvcnkuDQoNCgkJCS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KDQoJRG9uYXRlOiAgIGh0dHA6Ly9zdXBwb3J0Lmtlbm5leS5ubA0KCVJlcXVlc3Q6ICBodHRwOi8vcmVxdWVzdC5rZW5uZXkubmwNCg0KCUZvbGxvdyBvbiBUd2l0dGVyIGZvciB1cGRhdGVzOg0KCUBLZW5uZXlOTA==', 'base64')
const KENNEY_RPG_AUDIO_SOURCE = Buffer.from([
  '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',
  'NAEAAAAAAABAE0XAM0VANFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABxNAzRR',
  'BDRRBAAAAAAAAABNFAFRNQFPNAEAAAAAAABAE0VANE1AVE0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAABAAABDgAAARZCoSErAoA4AQCH40CSIEnwNIBjWfA8eBpME+BYFjwPmgfTBAAAAAAAAAAAAEDyNHgePA+mCZA0D54Hz4Np',
  'AgAAAAAAAAAAACB5HjwPngfTBEieB8+D58E0AQAAAAAAAAAAAPBME6YJ0YRqAjzThGnCNGGqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIABBwCAABPKQKEh',
  'KwKAOAEAh6NIEgAAOJJkWQAAoEiSZQEAgGVZngcAAJJleR4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAgAAAgAEHAIAAE8pAoSErAYAoAACHolgWcBzLAo5jWUCSLAtgWQBNA3gaQBQBgAAAgAIHAIAAGzQlFgcoNGQlABAFAOBwFMvSNFHkOJalaaLI',
  'cSxL00SRZWmapokiNEvTRBGe53mmCc/zPNOEKIqiaQJRNE0BAAAFDgAAATZoSiwOUGjISgAgJADA4TiW5XmiKIqmaZqqynEsy/NEURRNU1Vdl+NYlueJoiia',
  'pqq6LsvSNM8TRVE0TVV1XWia54miKJqmqrouNE0UTdM0VVVVXRea5ommaZqqqqquC88TRdM0TVV1XdcFomiapqmqruu6QBRN0zRV1XVdF4iiaJqmqrqu6wLT',
  'NE1VVV3XlWWAaaqqqrquLANUVVVd15VlGaCqquq6rivLANd1XdmVZVkG4LquK8uyLAAA4MABACDACDrJqLIIG0248AAUGrIiAIgCAACMYUoxpQxjEkIKoWFM',
  'QkghZFJSKimlCkIqJZVSQUilpFIySi2lllIFIZWSSqkgpFJSKQUAgB04AIAdWAiFhqwEAPIAAAhjlGLMOeckQkox5pxzEiGlGHPOOakUY84555yUkjHnnHNO',
  'SsmYc845J6VkzDnnnJNSOueccw5KKaV0zjnnpJRSQuicc1JKKZ1zzjkBAEAFDgAAATaKbE4wElRoyEoAIBUAwOA4lqVpnieKpmlJkqZ5nieapmlqkqRpnieK',
  'pmmaPM/zRFEUTVNVeZ7niaIomqaqcl1RFE3TNE1VJcuiKIqmqaqqCtM0TdNUVVWFaZqmaaqq68K2VVVVXdd1Yduqqqqu67rAdV3XdWUZuK7ruq4sCwAAT3AA',
  'ACqwYXWEk6KxwEJDVgIAGQAAhDEIKYQQUgYhpBBCSCmFkAAAgAEHAIAAE8pAoSErAYBwAACAEIwxxhhjjDE2jGGMMcYYY4wxcQpjjDHGGGOMMcYYY4wxxhhj',
  'jDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhj',
  'jDHGGGOMMcbYWmuttVYAGM6FA0BZhI0zrCSdFY4GFxqyEgAICQAAjEGIMegklJJKShVCjDkoJZWWWoqtQogxCKWk1FpsMRbPOQehpJRaiim24jnnpKTUWowx',
  'xlpcCyGllFqLLbYYm2whpJRSazHGWmMzSrWUWosxxhhrLEq5lFJrscUYa41FKJtbazHGWmutNSnlc0ux1VpjrLUmo4ySMcZaa6y11iKUUjLGFFOstdaahDDG',
  '9xhjrDHnWpMSwvgeUy2x1VprUkopI2SNqcZac05KCWWMjS3VlHPOBQBAPTgAQCUYQScZVRZhowkXHoBCQ1YCALkBAAhCSjHGmHPOOeeccw5SpBhzzDnnIIQQ',
  'QgghpAgxxphzzkEIIYQQQkgZY8w55yCEEEIIoYSSUsqYc85BCCGEUkopJaXUOecghBBCKKWUUkpKqXPOQQghhFJKKaWUlFIIIYQQQgillFJKKSmllEIIIYQS',
  'SimllFJSSimFEEIIpZRSSimlpJRSCiGEEEoppZRSSkkppRRCCaWUUkoppZSSUkoppRBKKaWUUkopJaWUUkqllFJKKaWUUkpKKaWUSimllFJKKaWUlFJKKZVS',
  'SimllFJKKSmllFJKqZRSSimllFJSSimllFIppZRSSimlpJRSSimlUkoppZRSSkkppZRSSqWUUkoppZSSUkoppZRSKqWUUkoppQAAoAMHAIAAIyotxE4zrjwC',
  'RxQyTECFhqwEAMgAABAHsbTWWquMcspJSa1DRhrmoKTYSQchtVhLZSBByklKnYIIKQaphYwqpZiTlkLLmFIMYisxdIwxRznlVELHGAAAAIIAAAMRMhMIFECB',
  'gQwAOEBIkAIACgsMHcNFQEAuIaPAoHBMOCedNgAAQYhPZ2dTAAEAAAAAAAAAADliAAACAAAAQcHO6QGRzBCJiMUgMaEaKCqmA4DFBYZ8AMjQ2Ei7uIAuA1zQ',
  'xV0HQghCEIJYHEABCTg44YYn3vCEG5ygU1TqQAAAAAAAHADgAQAg2QAiIqKZ4+jw+AAJERkhKTE5QREAAAAAADYA+AAASFKAiIho5jg6PD5AQkRGSEpMTlAC',
  'AAABBAAAAABAAAEICAgAAAAAAAQAAAAICE9nZ1MABNMcAAAAAAAAOWIAAAMAAABzeOWFJkNDREhDRVRYWUFFQkJaVlVDQ0FFQ0RbW/9u/2P/Y0BRUlD/S/8Z',
  'bBnLTUZ7XPtOtVPI0m4sNzFWxL76ALbCGNwCvrykZBmCBlrqVKrCERFXsICS2NOLMFHQNRSphQGuoD3jqC3G1PP/oUwhdyyelcl3FcMdm5JFk6ehEk+ByHSc',
  '/lw1AweTFNzXedfMxHYGTRKcNSkWZ1vxm2p1Lga9AfY+NNDPDzcGQQNERx5kIQu68lx5CZwxK+lZtGeOpIjt4fwDOBSmoFUInD7x+9hdDyprE8p9CA2edaKu',
  'iVnn0yOcNVUSd1NHN4zbu9OsbCk4J6whxUyOqtug7xnjS4lGaSetZ4H/WB+AK0UhUD8E/HHJzuazE8hVDLN1zK8p6PO9wjeqjtuUw7kmYWqTi+T63Np4L7DE',
  'ddB2AIQZy63KsLgJ8KqO5bo0LJ46+B8gimEFyhYg3nDt8WHMac60KrRlUMUTI+q3TIuAXo2RehYiirfUPtGiZ78HYOY2XgGkIQVnhwsxOdcJk5CF0bNWIWtQ',
  '6lQI9AGqGMbgcweUXrp2XigVNCtwnRl10pWhHOI10mzkpRS52hD1SBvpU9P1d5LP1gmMJXUx4XikIeN+VJXSGxIbL2NbOBW8RdmBXu3Xz8WG9VdYVWGV77/t',
  '6/JX7C9flU99/VhWZKVbEb1nVociCsgch467l+4gEsRGeLUNx7ENOsFBMBy0Ma/MwdulDwth92w77pg87S+6TZx7foBFRKE7AgQHo51pjcsUjWLtYtSV1IfY',
  'rueZzyqFd+DFGTh1IqOoaD3IwbllhURHhSKSjRG4v+BwPL9T+qnDUjMJ3BV3LD8fqFEh3fUdvd1+t8hyBvgfIKZXoHsJtrzm2Y2FOZZVVEG3spIMmEDVpRxX',
  '1af6KSSl1ko9VbwoOUF0Rd8teVvblN8GbsXe8C8+UXdd51betobLvwAEFkuash3YgOzlFQszu3+1FjUuvP/x6tE8AhfDGAXqqxMEXUIUQ9VS8ZATxMYeCfQ1',
  'igktEw/p8mLJy7n0X2W7GNwRr30Y7UsHxGIMWytePe3KX2kB7vGXN1ZEJpeSEuhVdcWYCRXKbTqGCL/EFY48tHamdBIZ05iVLjO/e2BfCOuiS4KKBBQSvdnY',
  'gkmKILeOWJDtxsyMgs479sqhSISuJEXLtDtYb6RQUYPlMI0nt2tKGmwlqXT8dpemEUHt4WIwNhvTCKErJKwNdyTDoGJU8POMHsfsYLagTffr5x8eDdiKSuTk',
  'pKOUX9NBl4ZVC8bR0n1u48kABSaUhCphAU+g8PpkSxiIwPIQAOQZvZYcsoLCostYpMogodgpF/wPsKoZ+tccoPt5Vy+1SKPVzGqNqgUtawuhywXlyV5h6z6r',
  'q4gqiwN1xqVlo7u8Z9QLM5/wTvexNNKXNxXzLRTdYmkJ/yt4APwdSykNlYcOBJ0Zd6H2qPmoATIp5NZ9UWaQm230BrdVaN7Z5Wr1/nZS7NKFZgelenlZrw0R',
  'vIRe6bRqWbrjMAN1WUs3/ujchp3dutd/ojv2jvQcD2oH5Bl3SHucQRFx44pl2I5qZIHyAcLhglbAGOstSh/ab/VUVlWlbjXDNQO/QY6s2b8ql9A1ztgWXtee',
  'NVojVKnKUl3qaYBSGHsc8UAbeDvYsuDx1j1OACQGizlQAoRMiAvu4iBoU0GT9ACUMqP4ZgpY8FbgbC6Nn8REKiuFev1QNLXKEUFBV2hljEiHGAstTQ0Q1VRV',
  'HBjQBAEUCstzkMUIPdE54W4GFrOrgAcgbErx97XB5jrsLREpGEkiR+WBiFnsBQtRV0BLrevQRu0JBNFSCNQdMnIToBIWDwID5A3LU0oU00JPcJywVDBQxJAB',
  'xzqqsTIigmEozkvaqpS0d0rhilTIK+GDflcnRcsZGGyq6NvtmUvLOdgxRSpwthA8Fks4pzMEQhgeiz7ipMWMDmk93tCeLBNlrjD96b5nJnnN0OozUZ9d4JHo',
  'kPIqlToMIxyI3pZApuJUz4C5LVEExkHitAA8Kou4ao9GRZhWOCzmjp1aAbHeAxBWEoMaCfRPnjxP69OSIMaRBBkFGcnSpTmuZjISDp1VsSDBuVDrpj7PbczK',
  'VIoBFC4LEICGgl8nLAMKwoBEJPEOBPCUhNL2ARh/EVWCxSmnvSc4ng4FFXo15SXOZVBmWRmYkVMp4uJif0sZYAnoMImF1RxcSj0IMTqjl3if02ZKaUreKR9e',
  'sXrND9BVaYMuS2CuC1PLbEFUoygVRRFtYI6StZYtLfnTXyUi1965LNShbK8O7VRVnYvHhnhqzPpx6T8vQA8HOUvLpfTYPfoQrHY50GGFGO4q84oRUCz7g0aY',
  'D5DHdS5UesBMc11KO0pptadljXHVqJrK6x5LMt9/2BqmXUVZ2uJa1VcUK2o9W1xny9rPurzP58evow29MZvqTa3u5A8CIE5jADrJnDWOgfALYPTonCptkxp+',
  'GSDMu7xovf7k+Ots/f9pyidPr2Tv7J6VnA3Q+mzM6WsaqnXCkmpQCkSpa6x0Kjbn+GE5eLL8pP/qcqr2mKdqdg2WhXOoi6HFGRE1DjT2PuvHk4dyLkqxjLiI',
  'gzBwg7ysi2VVZNFkTY/CYFUtBqU1vXaPu1J1LWF7yMbkMpYVWwH3oJSrqZmcmoTIkaiqUgLRztuoii1LiuXqph05FJmA1nZ51ctEGSWZSa7WIeUil8pE0ZNM',
  'CEEhb3OQ2KenzyySYjJAQMr1jrAQZReXpqfjMgmCgIhl0YtSOo5mWQMFTGllBKtWCGI5a5TsaSU1AXIWAIPgPaCJXwHZ2aD2MgD0aJ6NzbzlFoeDBo56DYFM',
  'zoFbPxM6Xw0IAINwDHDb2ERakGwDGYBjixZfS8PwStFghzJSsVAOwCgmMzoYgzBgw8IDI8PQ4DGxbQTigHkCXUXPvwCKFKTbNNC0ylIAXpicFxgpEA8CZehk',
  'ft+JxuJKXgG46/PO69YLz8Pj7dlzr9eWGHO0mUiHmpl6t8Gumgu8NTRM1TlaX20TZ49GufsYuv+YP28m7P9ufFyNe+nMeOLGzZ+DbO5LzsZkLhq6Wbe+qIRZ',
  'xLi+KyK2QDMkLpArGBY5gYNLqARBZtFtyYKyeDfLaZ3KSOSiyZCpTba7UiSBWIMauWwV4whGKS9jMEVbs1iU7kmyDKZpKmVlXaVwcQZqvejdSEfm9BI68UZc',
  '0YmsmZg5hUVOu2yxUoZYbxmVLVxZpsmYbhRrlnpQjBXAIRYABtAKD0CQKvlEAHjsGiSGgQmH0GQS24VapLFBXjQgHlBEZkEUA9Asx3PwEHFOaWQjL4hgATgL',
  '4aKUpbDFEitaImITBUCE9/UnRyS4SIFtbDMCOSKRjAFTggiAOQAkh4pUgQAECFiLJfjuBLqkHXHndqEBA3YugABiAAAAAOUN9sVMHexjqIkaLmALGQv6pEoQ',
  '6stIqOEbAODL+/ajpXBmwLSIETOsrVLiS7G5tAKwb/dzdo7NCN/R27XYwN/UyjJf0+avuT5lNth8FuX6uBJN4pbm727eZO+p3pAWbmugaFmv/ztWYS5DebhF',
  '3i1uueN8vyHS2nAVSVptkWSpWkhJlh1y725qFBcR621HQSgUygJWOmF6vtP7XuKToIgn2xGT2Prg9ojI2eeuGgtuMyyE7VI8tbjijsIM1mXSTML7k1y+9+pu',
  'xx4EgWRACNrogqiUVZG1IMqUYRQEJgJMOWGhXh39RFIjAhwuhLhBBgAEQBLbalK2RwGQgA3ucAIIvaRDICIcBTSIXhtsodAWklUzC3hFKFgaszxFaFuKAICz',
  'GTXiL9OIQCCZUDJGih0ABlkIvCIpjoHMJOM1oShYwAMSkNLqxYAAEK/NI2BFAAaOvp/zHYAAeLCZsJV4lW+Oip2gHBVpkcxCFhK3j3EHiWpStoSC09V5ALgV',
  'GQavCVxnuTX5RZGEUppozW9FCIkVsyIWR4Xp1QhikFdM8toBcsZsBBQZoc6GmyZBC8VQUuqNBInEdngfIBYr1E+g+uam4mUohdYs3pfQ3NlhwVK4rkT4Vq5v',
  '7laXulZBdCOHVscIo9cAlOpJAUWPAWAEXFwdq+ORFDQNoQ8oxIZ/eGTEfhAMAzJtX4BaCZtwBfRKN0CHDD7Z5mIpJWmmQcRFrlJxGC21Fvqzqi/SIlqDdupW',
  'Q2ktYmVh1RI7kC3lBSsLq4J11WOnLABEHa0IpIzDdJQkCJAygek+zrfMIxaRW7mAj92ZSdNHNTzJU9OjUTpFcvt8PlM2Hvr02xmhLLUKqiC12iha0chLWZ6I',
  'cECYCHtE/I0U4asFANrFnLb0d1nCEuleYmPoQq47+GflNmL3Mjw3eXP+8fLs5YTxydHYLz+vvhQetcE260fNh3UEpS4zxZSUJBDlMpNrNGdw/MVYv9HJ7DQb',
  'lhB7Hfq5ujTG9jQrmXv8VsuDwy5Y4sxc1yoo2hCyR18pEqQUy9Z2n0rCtPVLDw3iCLebxAWqJQQ0lTWyiFPIoTqhBpBM5pQJFHBkOAFqBEj2AqigTC5rGzLb',
  'CYC8GIOEK84oVWsRuFahzBSVCRQFqIZel1JND3SCjUSR2p5CEbRluyq8ok6ALBiLI400iTWmtUohAq0NaAUEAwhCodYKAECTgExioaqyICkkTgnjzFYICMCa',
  'UfP2r3wmrNOMJtaveRnZxQEAjlIKywAKFUve8snsxSdE07fhQ2ff2btAqjcRnZHeiI66uuCEEyCKbFmS9OEhKmkzlQZcZ1gWAJ6F/HMwbvQHRJZ2E7OQfw/G',
  'jfiBDi7sFjazdpgmmeoMFWRakEkAAMBiFtMAAAD00NO5Ptvy3u3qdyqPvVg6knt39flxPI9lJj0feRZnr2KaLOTsMKo18ARhK1RaWFNNCcsO7GBFa6d7qneR',
  'd2Z8EUeuk0qhSpT1pCwdyzIsa/e6jCMjT8d4PrjyWlvhQhi4grAVSqQlEZtMselifDdoaAsvJghFLA0srZhqJVOSj7JYPp4sc13ou6EHzqQlrmVGLTEYgGfi',
  'T678x/G1jFoiLbEAgWWyMIoqRaWQioKq2IpKoUrEomSyoHLIvZYYyqONtkSvTC33JzVz9QAAeLLgwwb2G7JPOkZGFutiLyulSwBswZMN3zRdCAU=',
].join(''), 'base64')

const AUDIO_SOURCE_IDS = new Set(['ambience','footstep-a','footstep-b','interaction','swing','impact','refusal','success','cooldown','recovery'])
export const CC0_TEXT = KENNEY_TINY_DUNGEON_LICENCE.toString('utf8')
export function catalogSourceBytes(id: string): Buffer { return Buffer.from(AUDIO_SOURCE_IDS.has(id) ? KENNEY_RPG_AUDIO_SOURCE : KENNEY_TINY_DUNGEON_SOURCE) }
export function catalogLicenceBytes(id: string): Buffer { return Buffer.from(AUDIO_SOURCE_IDS.has(id) ? KENNEY_RPG_AUDIO_LICENCE : KENNEY_TINY_DUNGEON_LICENCE) }

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngCrc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([header, data, crc])
}

/** An 8x8 greyscale PNG with a real deflate stream and valid chunk CRCs. */
export function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8
  const rows: Buffer[] = []
  for (let y = 0; y < 8; y += 1) {
    const row = Buffer.alloc(9)
    for (let x = 0; x < 8; x += 1) row[1 + x] = (x * 32 + y * 7) & 0xff
    rows.push(row)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** A 16x16 single-colour PNG whose legal row filters disguise its uniform decoded pixels. */
export function uniformFilteredPng(): Buffer {
  const width = 16; const height = 16; const value = 128
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8
  const rows: Buffer[] = []
  const paeth = (left: number, up: number, upperLeft: number) => { const estimate = left + up - upperLeft; const leftDistance = Math.abs(estimate - left); const upDistance = Math.abs(estimate - up); const upperLeftDistance = Math.abs(estimate - upperLeft); return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft }
  for (let y = 0; y < height; y += 1) {
    const filter = y % 5; const row = Buffer.alloc(width + 1); row[0] = filter
    for (let x = 0; x < width; x += 1) {
      const left = x > 0 ? value : 0; const up = y > 0 ? value : 0; const upperLeft = x > 0 && y > 0 ? value : 0
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft)
      row[x + 1] = (value - predictor) & 0xff
    }
    rows.push(row)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** Palette indices vary, but every entry resolves to the same visible colour. */
export function uniformPalettePng(): Buffer {
  const width = 16; const height = 16
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3
  const palette = Buffer.from([40,80,120, 40,80,120, 40,80,120, 40,80,120])
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) { const row = Buffer.alloc(width + 1); for (let x = 0; x < width; x += 1) row[x + 1] = (x + y) % 4; rows.push(row) }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('PLTE', palette), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** Four legitimate colours appear first, followed by an out-of-range palette index. */
export function outOfRangePaletteIndexPng(): Buffer {
  const width = 16; const height = 16
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3
  const palette = Buffer.from([255,0,0, 0,255,0, 0,0,255, 255,255,0])
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) { const row = Buffer.alloc(width + 1); for (let x = 0; x < width; x += 1) row[x + 1] = (x + y) % 4; rows.push(row) }
  rows[height - 1]![width] = 4
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('PLTE', palette), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** Four palette colours are referenced, but every pixel is fully transparent. */
export function transparentPalettePng(): Buffer {
  const width = 16; const height = 16
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3
  const palette = Buffer.from([240,20,20, 20,240,20, 20,20,240, 240,240,20]); const transparency = Buffer.alloc(4)
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) { const row = Buffer.alloc(width + 1); for (let x = 0; x < width; x += 1) row[x + 1] = (x + y) % 4; rows.push(row) }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('PLTE', palette), pngChunk('tRNS', transparency), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** Distinct RGB bytes in RGBA pixels remain visually empty at alpha zero. */
export function transparentRgbaPng(): Buffer {
  const width = 16; const height = 16
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) { const row = Buffer.alloc(width * 4 + 1); for (let x = 0; x < width; x += 1) { const at = 1 + x * 4; row[at] = x * 13; row[at + 1] = y * 17; row[at + 2] = (x + y) * 9; row[at + 3] = 0 } rows.push(row) }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** Indexed tRNS must contain at least one alpha entry. */
export function emptyPaletteTransparencyPng(): Buffer {
  const valid = uniformPalettePng(); const data = valid.indexOf(Buffer.from('IDAT'))
  return Buffer.concat([valid.subarray(0, data - 4), pngChunk('tRNS', Buffer.alloc(0)), valid.subarray(data - 4)])
}

/** A 16x16 decoded grayscale gradient that clears the placeholder floor. */
export function variedPng(): Buffer {
  const width = 16; const height = 16
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8
  const rows: Buffer[] = []
  for (let y = 0; y < height; y += 1) { const row = Buffer.alloc(width + 1); for (let x = 0; x < width; x += 1) row[x + 1] = (x * 17 + y * 11) & 0xff; rows.push(row) }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** A CRC-correct PNG whose IDAT bytes are not a decodable zlib stream. */
export function pngWithInvalidDeflate(): Buffer {
  const valid = tinyPng()
  const idat = valid.indexOf(Buffer.from('IDAT'))
  const length = valid.readUInt32BE(idat - 4)
  const payload = Buffer.alloc(length)
  return Buffer.concat([valid.subarray(0, idat - 4), pngChunk('IDAT', payload), valid.subarray(idat + 8 + length)])
}

/** A minimal glTF 2.0 binary: one triangle mesh, plus one translation animation when requested. */
export function tinyGlb(kind: 'model' | 'animation'): Buffer {
  const bin = Buffer.alloc(68)
  bin.writeFloatLE(1, 12)
  bin.writeFloatLE(1, 28)
  bin.writeFloatLE(1, 40)
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
  if (kind === 'animation') gltf.animations = [{ channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }] }]
  let json = Buffer.from(JSON.stringify(gltf), 'utf8')
  if (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)])
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(json.length, 0)
  jsonHeader.write('JSON', 4, 'ascii')
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, json, binHeader, bin])
}

function packedGlb(gltf: Record<string, unknown>, bin: Buffer): Buffer {
  let json = Buffer.from(JSON.stringify(gltf), 'utf8')
  if (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)])
  const header = Buffer.alloc(12); header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.write('JSON', 4, 'ascii')
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, json, binHeader, bin])
}

function indexedModelGlb(
  positions: readonly number[],
  indices: readonly number[],
  options: { readonly mode?: number; readonly extraUnreferencedMesh?: boolean; readonly extraPointPrimitive?: boolean; readonly misalignedColor?: boolean } = {},
): Buffer {
  const positionBytes = Buffer.alloc(positions.length * 4)
  positions.forEach((value, index) => positionBytes.writeFloatLE(value, index * 4))
  const indexBytes = Buffer.alloc(indices.length * 2)
  indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2))
  const geometry = Buffer.concat([positionBytes, indexBytes, Buffer.alloc((4 - ((positionBytes.length + indexBytes.length) % 4)) % 4)])
  const colorView = options.misalignedColor ? Buffer.alloc(18) : Buffer.alloc(0)
  const bin = Buffer.concat([geometry, colorView, Buffer.alloc((4 - ((geometry.length + colorView.length) % 4)) % 4)])
  const triangle = { attributes: { POSITION: 0, ...(options.misalignedColor ? { COLOR_0: 2 } : {}) }, indices: 1, mode: options.mode ?? 4 }
  const primitives = options.extraPointPrimitive ? [triangle, { attributes: { POSITION: 0 }, mode: 0 }] : [triangle]
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positionBytes.length }, { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length }, ...(options.misalignedColor ? [{ buffer: 0, byteOffset: geometry.length, byteLength: colorView.length }] : [])],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }, ...(options.misalignedColor ? [{ bufferView: 2, byteOffset: 2, componentType: 5121, normalized: true, count: positions.length / 3, type: 'VEC4' }] : [])],
    meshes: [{ primitives }, ...(options.extraUnreferencedMesh ? [{ primitives: [triangle] }] : [])],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

/** Four finite points hidden in an unreferenced mesh behind an empty active scene. */
export function unreferencedPointGlb(): Buffer {
  const bin = Buffer.alloc(48)
  ;[0,0,0, 1,0,0, 0,1,0, 1,1,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }],
    nodes: [{}], scenes: [{ nodes: [] }], scene: 0,
  }, bin)
}

/** Observable motion on node 2 plus a dummy skin whose joints are never used by a scene node. */
export function dummySkinAnimationGlb(): Buffer {
  const bin = Buffer.alloc(32); bin.writeFloatLE(0, 0); bin.writeFloatLE(1, 4)
  ;[0,0,0, 1,0,0].forEach((value, index) => bin.writeFloatLE(value, 8 + index * 4))
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC3' }],
    nodes: [{}, {}, {}], skins: [{ joints: [0, 1] }], animations: [{ samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }] }],
    scenes: [{ nodes: [] }], scene: 0,
  }, bin)
}

/** A scene-referenced triangle strip with four finite, non-degenerate vertices. */
export function sceneTriangleGlb(): Buffer {
  const bin = Buffer.alloc(48)
  ;[0,0,0, 1,0,0, 0,1,0, 1,1,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

const SQUARE_POSITIONS = [0,0,0, 1,0,0, 0,1,0, 1,1,0] as const

/** Four stored positions but only one referenced triangle: the fourth cannot satisfy the floor. */
export function unusedFourthPositionGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2])
}

/** Two triangles address four indices, but the fourth coordinate repeats the third. */
export function repeatedFourthPositionGlb(): Buffer {
  return indexedModelGlb([0,0,0, 1,0,0, 0,1,0, 0,1,0], [0,1,2, 0,1,3])
}

/** A good triangle followed by a zero-area triangle must not hide the degenerate geometry. */
export function mixedDegenerateTriangleGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2, 0,0,3])
}

/** One valid scene mesh plus a second declared mesh that no active-scene node references. */
export function extraUnreferencedMeshGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2, 1,3,2], { extraUnreferencedMesh: true })
}

/** A reachable mesh may not combine accepted triangles with a point-only primitive. */
export function mixedTrianglePointGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2, 1,3,2], { extraPointPrimitive: true })
}

/** A scene-reachable point-only primitive isolates topology rejection from scene reachability. */
export function referencedPointGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2,3], { mode: 0 })
}

/** An index outside the POSITION accessor must fail safely before any coordinate read. */
export function outOfRangeIndexGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,4, 1,3,2])
}

/** Two indexed non-degenerate triangles over four referenced coordinates. */
export function indexedQuadGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2, 1,3,2])
}

/** A non-skin vertex semantic whose data starts at byte two inside its buffer view. */
export function misalignedNonSkinVertexAttributeGlb(): Buffer {
  return indexedModelGlb(SQUARE_POSITIONS, [0,1,2, 1,3,2], { misalignedColor: true })
}

interface SkinnedAnimationOptions {
  readonly attachSkin?: boolean
  readonly includeJoints?: boolean
  readonly includeWeights?: boolean
  readonly extraUnpairedJointSet?: boolean
  readonly inverseBindMatrices?: number
  readonly joints?: readonly number[]
  readonly jointValues?: readonly number[]
  readonly jointNormalized?: boolean
  readonly jointCount?: number
  readonly misalignAnimationInput?: boolean
  readonly nodeChildren?: readonly number[]
  readonly weightValues?: readonly number[]
  readonly weightComponentType?: 5121 | 5126
  readonly weightNormalized?: boolean
  readonly weightCount?: number
  readonly weightType?: 'VEC3' | 'VEC4'
  readonly skeleton?: number
  readonly target?: number
}

function skinnedAnimationGlb(options: SkinnedAnimationOptions = {}): Buffer {
  const positions = Buffer.alloc(36)
  ;[0,0,0, 1,0,0, 0,1,0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const jointValues = options.jointValues ?? [0,0,0,0, 1,0,0,0, 0,0,0,0]
  const joints = Buffer.from(jointValues)
  const weightComponentType = options.weightComponentType ?? 5121
  const weightValues = options.weightValues ?? (weightComponentType === 5126 ? [1,0,0,0, 1,0,0,0, 1,0,0,0] : [255,0,0,0, 255,0,0,0, 255,0,0,0])
  const weights = Buffer.alloc(weightValues.length * (weightComponentType === 5126 ? 4 : 1))
  weightValues.forEach((value, index) => weightComponentType === 5126 ? weights.writeFloatLE(value, index * 4) : weights.writeUInt8(value, index))
  const times = Buffer.alloc(8); times.writeFloatLE(1, 4)
  const output = Buffer.alloc(24); output.writeFloatLE(1, 12)
  const parts = [positions, joints, weights, times, output]; const offsets: number[] = []; let offset = 0
  for (const part of parts) { offsets.push(offset); offset += part.length }
  const bin = Buffer.concat(parts)
  const attributes: Record<string, number> = { POSITION: 0 }
  if (options.includeJoints !== false) attributes.JOINTS_0 = 1
  if (options.includeWeights !== false) attributes.WEIGHTS_0 = 2
  if (options.extraUnpairedJointSet) attributes.JOINTS_1 = 1
  const jointAccessor = { bufferView: 1, componentType: 5121, count: options.jointCount ?? 3, type: 'VEC4', ...(options.jointNormalized === undefined ? {} : { normalized: options.jointNormalized }) }
  const defaultWeightNormalized = weightComponentType === 5121 ? true : undefined
  const weightAccessor = { bufferView: 2, componentType: weightComponentType, count: options.weightCount ?? 3, type: options.weightType ?? 'VEC4', ...(options.weightNormalized === undefined ? (defaultWeightNormalized === undefined ? {} : { normalized: defaultWeightNormalized }) : { normalized: options.weightNormalized }) }
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: parts.map((part, index) => ({ buffer: 0, byteOffset: offsets[index]! + (options.misalignAnimationInput && index === 3 ? 2 : 0), byteLength: part.length })),
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, jointAccessor, weightAccessor, { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes }] }], nodes: [{ mesh: 0, ...(options.attachSkin === false ? {} : { skin: 0 }), children: [...(options.nodeChildren ?? [1,2,3])] }, {}, {}, {}], skins: [{ joints: [...(options.joints ?? [1,2])], ...(options.skeleton === undefined ? {} : { skeleton: options.skeleton }), ...(options.inverseBindMatrices === undefined ? {} : { inverseBindMatrices: options.inverseBindMatrices }) }],
    animations: [{ samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: options.target ?? 1, path: 'translation' } }] }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

/** Observable motion on an influencing joint of a genuinely skinned scene mesh. */
export function riggedAnimationGlb(): Buffer { return skinnedAnimationGlb() }

/** Two joints share the scene-visible skinned mesh node as a root without an explicit skeleton. */
export function sharedRootSkinAnimationGlb(): Buffer { return skinnedAnimationGlb() }

/** The declared skeleton is the scene-visible ancestor of every joint. */
export function ancestorSkeletonAnimationGlb(): Buffer { return skinnedAnimationGlb({ skeleton: 0 }) }

/** An in-scene sibling cannot stand in for the joints' common ancestor. */
export function siblingSkeletonAnimationGlb(): Buffer { return skinnedAnimationGlb({ skeleton: 3 }) }

/** Joint nodes outside the active scene do not form a usable skin hierarchy. */
export function disconnectedJointAnimationGlb(): Buffer { return skinnedAnimationGlb({ nodeChildren: [3] }) }

/** JOINTS_0 begins at absolute byte 40 but at illegal byte two inside its view. */
export function misalignedJointVertexAttributeGlb(): Buffer {
  const bin = Buffer.alloc(96)
  ;[0,0,0, 1,0,0, 0,1,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  ;[0,0,0,0, 1,0,0,0, 0,0,0,0].forEach((value, index) => { bin[40 + index] = value })
  for (let vertex = 0; vertex < 3; vertex += 1) bin[52 + vertex * 4] = 255
  bin.writeFloatLE(1, 68); bin.writeFloatLE(1, 84)
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 38, byteLength: 14 }, { buffer: 0, byteOffset: 52, byteLength: 12 }, { buffer: 0, byteOffset: 64, byteLength: 8 }, { buffer: 0, byteOffset: 72, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, byteOffset: 2, componentType: 5121, count: 3, type: 'VEC4' }, { bufferView: 2, componentType: 5121, normalized: true, count: 3, type: 'VEC4' }, { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }], nodes: [{ mesh: 0, skin: 0, children: [1,2,3] }, {}, {}, {}], skins: [{ joints: [1,2] }],
    animations: [{ samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

/** A skin index and mesh index without the required vertex skinning attributes. */
export function missingSkinAttributesAnimationGlb(): Buffer { return skinnedAnimationGlb({ includeJoints: false, includeWeights: false }) }

/** Unsigned integer weights must opt into normalized decoding. */
export function unnormalizedSkinWeightsAnimationGlb(): Buffer { return skinnedAnimationGlb({ weightNormalized: false }) }

/** Every joint accessor component indexes the attached skin's joints array. */
export function outOfRangeSkinJointAnimationGlb(): Buffer { return skinnedAnimationGlb({ jointValues: [0,0,0,0, 2,0,0,0, 0,0,0,0] }) }

/** Syntactically legal weights with no influence cannot make a skin usable. */
export function zeroWeightSkinAnimationGlb(): Buffer { return skinnedAnimationGlb({ weightValues: new Array(12).fill(0) }) }

/** Skin attribute accessors must match the primitive's POSITION count. */
export function mismatchedSkinAccessorCountAnimationGlb(): Buffer { return skinnedAnimationGlb({ weightCount: 2 }) }

/** Additional joint and weight attribute sets must be paired. */
export function unpairedSkinSetAnimationGlb(): Buffer { return skinnedAnimationGlb({ extraUnpairedJointSet: true }) }

/** Float weights must be finite before they can influence a rendered vertex. */
export function nonFiniteSkinWeightAnimationGlb(): Buffer { return skinnedAnimationGlb({ weightComponentType: 5126, weightValues: [1,0,0,0, Number.NaN,0,0,0, 1,0,0,0] }) }

/** Finite float weights still need a usable normalized per-vertex sum. */
export function hugeSkinWeightAnimationGlb(): Buffer { return skinnedAnimationGlb({ weightComponentType: 5126, weightValues: [1,0,0,0, 1e30,0,0,0, 1,0,0,0] }) }

/** An inverse-bind-matrix reference must address one FLOAT MAT4 per joint. */
export function invalidInverseBindMatricesAnimationGlb(): Buffer { return skinnedAnimationGlb({ inverseBindMatrices: 0 }) }

/** An optional skeleton reference must address a real node. */
export function outOfRangeSkeletonAnimationGlb(): Buffer { return skinnedAnimationGlb({ skeleton: 4 }) }

/** Accessor alignment uses the buffer view's offset plus the accessor offset. */
export function misalignedAccessorAnimationGlb(): Buffer { return skinnedAnimationGlb({ misalignAnimationInput: true }) }

/** A triangle plus a fourth POSITION that is unreferenced or repeats the first vertex. */
export function paddedTriangleGlb(indexed: boolean): Buffer {
  const bin = Buffer.alloc(indexed ? 52 : 48)
  ;[0,0,0, 1,0,0, 0,1,0, 0,0,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  if (indexed) { bin[48] = 0; bin[49] = 1; bin[50] = 2 }
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: indexed ? [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 3 }] : [{ buffer: 0, byteOffset: 0, byteLength: 48 }],
    accessors: indexed ? [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }, { bufferView: 1, componentType: 5121, count: 3, type: 'SCALAR' }] : [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(indexed ? { indices: 1 } : {}), mode: 4 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

/** A scene-visible valid strip whose node hierarchy contains a self or two-node cycle. */
export function cyclicSceneGlb(twoNodes = false): Buffer {
  const bin = Buffer.alloc(48)
  ;[0,0,0, 1,0,0, 0,1,0, 1,1,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
    nodes: twoNodes ? [{ mesh: 0, children: [1] }, { children: [0] }] : [{ mesh: 0, children: [0] }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

function indexedSkinPaddingGlb(options: { readonly indexAccessor?: number; readonly indexCount?: number; readonly lastIndex?: number } = {}): Buffer {
  const bin = Buffer.alloc(164)
  ;[0,0,0, 1,0,0, 0,1,0, 1,1,0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  bin[48] = 0; bin[49] = 1; bin[50] = options.lastIndex ?? 2
  bin.writeFloatLE(0, 52); bin.writeFloatLE(1, 56)
  ;[0,0,0, 1,0,0].forEach((value, index) => bin.writeFloatLE(value, 60 + index * 4))
  for (let vertex = 0; vertex < 4; vertex += 1) {
    bin[84 + vertex * 4] = vertex === 3 ? 1 : 0
    bin.writeFloatLE(1, 100 + vertex * 16)
  }
  return packedGlb({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 3 },
      { buffer: 0, byteOffset: 52, byteLength: 8 }, { buffer: 0, byteOffset: 60, byteLength: 24 },
      { buffer: 0, byteOffset: 84, byteLength: 16 }, { buffer: 0, byteOffset: 100, byteLength: 64 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: options.indexCount ?? 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 4, componentType: 5121, count: 4, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: 4, type: 'VEC4' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 4, WEIGHTS_0: 5 }, indices: options.indexAccessor ?? 1, mode: 4 }] }],
    nodes: [{ mesh: 0, skin: 0, children: [1,2] }, {}, {}], skins: [{ joints: [1,2] }],
    animations: [{ samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }] }], scenes: [{ nodes: [0] }], scene: 0,
  }, bin)
}

/** Only accessor padding is influenced by the animated joint; the indexed triangle uses vertices 0-2. */
export function paddingOnlyInfluencedJointAnimationGlb(): Buffer {
  return indexedSkinPaddingGlb()
}

/** A hostile index references a vertex outside the POSITION/skin accessor boundary. */
export function outOfRangeSkinIndexAnimationGlb(): Buffer {
  return indexedSkinPaddingGlb({ lastIndex: 4 })
}

/** A primitive cannot smuggle an out-of-range accessor id into skin topology analysis. */
export function outOfRangeSkinIndexAccessorAnimationGlb(): Buffer {
  return indexedSkinPaddingGlb({ indexAccessor: 99 })
}

/** An index count above the global accessor ceiling must fail before traversal or allocation. */
export function oversizedSkinIndexCountAnimationGlb(): Buffer {
  return indexedSkinPaddingGlb({ indexCount: 16_777_217 })
}

/** The animated joint belongs only to a skin that no scene-reachable mesh node uses. */
export function unusedSkinJointAnimationGlb(): Buffer {
  return skinnedAnimationGlb({ attachSkin: false, joints: [1,2], target: 1 })
}

/** A skin is used, but the observable channel targets a reachable non-joint node. */
export function unrelatedUsedSkinAnimationGlb(): Buffer {
  return skinnedAnimationGlb({ joints: [1,2], target: 3 })
}

/** Repeating one node does not create the required two-joint rig. */
export function duplicateJointSkinAnimationGlb(): Buffer {
  return skinnedAnimationGlb({ joints: [1,1], target: 1 })
}

/** Motion on an unweighted joint is not observable skinned-vertex motion. */
export function uninfluencedJointAnimationGlb(): Buffer {
  return skinnedAnimationGlb({ jointValues: new Array(12).fill(0), joints: [1,2], target: 2 })
}

/** A container-valid GLB whose mesh points at a nonexistent accessor. */
export function glbWithOutOfRangePosition(kind: 'model' | 'animation' = 'model'): Buffer {
  const bytes = tinyGlb(kind)
  const marker = Buffer.from('"POSITION":0')
  const offset = bytes.indexOf(marker)
  if (offset < 0) throw new Error('fixture POSITION accessor not found')
  bytes[offset + marker.length - 1] = 0x39
  return bytes
}

function oggCrc32(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc = ((crc << 8) >>> 0) ^ oggTable[((crc >>> 24) ^ byte) & 0xff]!
  }
  return crc >>> 0
}

const oggTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let r = (n << 24) >>> 0
    for (let k = 0; k < 8; k += 1) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    table[n] = r
  }
  return table
})()

function oggPage(serial: number, sequence: number, granule: bigint, flags: number, packets: readonly Buffer[]): Buffer {
  const segments = packets.map((packet) => {
    if (packet.length >= 255) throw new Error('fixture packets must stay below one lacing segment')
    return packet.length
  })
  const header = Buffer.alloc(27 + segments.length)
  header.write('OggS', 0, 'ascii')
  header[5] = flags
  header.writeBigUInt64LE(granule, 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = segments.length
  segments.forEach((value, index) => { header[27 + index] = value })
  const page = Buffer.concat([header, ...packets])
  page.writeUInt32LE(oggCrc32(page), 22)
  return page
}

/** A minimal Ogg Opus stream: identification, tags, and one terminating audio page with valid page CRCs. */
export function tinyOgg(): Buffer {
  const serial = 0x6b6569
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head[8] = 1
  head[9] = 1
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  const vendor = Buffer.from('kei', 'utf8')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'ascii')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  const audio = Buffer.from([0xfc, 0xff, 0xfe])
  return Buffer.concat([
    oggPage(serial, 0, 0n, 0x02, [head]),
    oggPage(serial, 1, 0n, 0x00, [tags]),
    oggPage(serial, 2, 960n, 0x04, [audio]),
  ])
}


/** Header and tags plus a CRC-correct EOS page, but no Opus audio packet. */
export function oggWithoutAudioPacket(): Buffer {
  const serial = 0x6b6569
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head[8] = 1
  head[9] = 1
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  const vendor = Buffer.from('kei', 'utf8')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'ascii')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  return Buffer.concat([
    oggPage(serial, 0, 0n, 0x02, [head]),
    oggPage(serial, 1, 0n, 0x00, [tags]),
    oggPage(serial, 2, 960n, 0x04, []),
  ])
}
