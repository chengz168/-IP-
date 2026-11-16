// 依据参考界面公开标签和配置保存参数，动画由独立引擎实现。
export const subtitleFontFamilies={'微软雅黑':'Microsoft YaHei','黑体':'SimHei','思源宋体':'Source Han Serif SC Heavy','三极行楷简体':'SJxingkai-C','小石头体':'也字工厂小石头','江城律动宋':'JiangChengLvDongSong'};
export const subtitleTemplates=[
  {
    "id": "yellow_white_split",
    "name": "黄白裂开",
    "description": "黄色打字机与白色缩放组合",
    "preview": [
      "重点来了",
      "马上看懂"
    ],
    "config": {
      "fontFamily": "思源宋体",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "typewriter",
        "zoom_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "yellow_white_italic",
    "name": "黄白斜体",
    "description": "黄白交替，多种进退场动效",
    "preview": [
      "效率提升",
      "现在开始"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold",
        "italic"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in",
        "slide_up"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "yellow_white_calligraphy",
    "name": "黄白书法",
    "description": "书法字体，黄白渐变氛围",
    "preview": [
      "人生建议",
      "一定要看"
    ],
    "config": {
      "fontFamily": "三极行楷简体",
      "fontSize": 88,
      "fontStyles": [
        "bold"
      ],
      "color": "#FDF084",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 4,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "yellow_white_bounce",
    "name": "黄白跳动",
    "description": "黄白交替，逐字跳动感",
    "preview": [
      "这一步",
      "很关键"
    ],
    "config": {
      "fontFamily": "思源宋体",
      "fontSize": 86,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "bounce"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "yellow_box_white",
    "name": "黄底白字",
    "description": "黄色背景框，打字机表达",
    "preview": [
      "关键结论",
      "直接看这里"
    ],
    "config": {
      "fontFamily": "黑体",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": false,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "solid",
      "backgroundColor": "#FFE000",
      "backgroundOpacity": 0.95,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "typewriter"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "white_pinyin",
    "name": "白色注音",
    "description": "白字黑边，适合清晰口播",
    "preview": [
      "读准重点",
      "跟着念"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 3,
      "strokeColor": "#000000",
      "enableShadow": false,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "variety_wave",
    "name": "综艺波浪",
    "description": "粉绿白配色，综艺逐字入场",
    "preview": [
      "太有意思了",
      "继续往下看"
    ],
    "config": {
      "fontFamily": "小石头体",
      "fontSize": 88,
      "fontStyles": [
        "bold"
      ],
      "color": "#FDD1A3",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "wave"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "simple_brown_white",
    "name": "棕白简约",
    "description": "棕色与白色交替，适合质感口播",
    "preview": [
      "慢慢变好",
      "坚持就对了"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#8B5A2B",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#FFFFFF",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "simple_yellow_white",
    "name": "简约黄白",
    "description": "黄白交替，基础缩放和移动",
    "preview": [
      "这个方法",
      "真的很实用"
    ],
    "config": {
      "fontFamily": "江城律动宋",
      "fontSize": 86,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 4,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in",
        "zoom_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "scrolling_4lines",
    "name": "四行滚动",
    "description": "四行显示，当前行高亮",
    "preview": [
      "第一行内容",
      "当前行高亮"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 64,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "solid",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.28,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1320,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "simple_blue_white",
    "name": "蓝白简约",
    "description": "蓝白配色，适合知识科普",
    "preview": [
      "效率提升",
      "马上看懂"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#2775FF",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#001A4D",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "scrolling_3lines",
    "name": "三行滚动",
    "description": "三行滚动，卡拉 OK 式高亮",
    "preview": [
      "上一句",
      "当前重点"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 68,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "solid",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.22,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1360,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "red_yellow",
    "name": "红黄字幕",
    "description": "红黄白配色，短视频冲击感",
    "preview": [
      "注意看",
      "重点来了"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 3,
      "strokeColor": "#A30023",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "red_blue_science",
    "name": "红蓝科普",
    "description": "红蓝交替，适合科普讲解",
    "preview": [
      "原理很简单",
      "这样理解"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#3F509B",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#FFFFFF",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "purple_slide",
    "name": "紫色滑块",
    "description": "紫色滑块背景，逐字显示",
    "preview": [
      "快速掌握",
      "核心技巧"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": false,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "solid",
      "backgroundColor": "#7C3AED",
      "backgroundOpacity": 0.88,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "slide_up"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "cartoon_yellow",
    "name": "卡通黄白",
    "description": "卡通黄白，打字机和光标效果",
    "preview": [
      "太可爱了",
      "快试试看"
    ],
    "config": {
      "fontFamily": "小石头体",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFE66D",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 3,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "typewriter"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "energy_pink_yellow",
    "name": "活力粉黄",
    "description": "粉黄波浪，适合生活娱乐",
    "preview": [
      "元气满满",
      "一起冲呀"
    ],
    "config": {
      "fontFamily": "小石头体",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD166",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 3,
      "strokeColor": "#FF5CA8",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "wave",
        "bounce"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "cute_pink",
    "name": "可爱彩色",
    "description": "粉嫩配色，逐字弹跳",
    "preview": [
      "太可爱了",
      "赶紧试试看"
    ],
    "config": {
      "fontFamily": "小石头体",
      "fontSize": 88,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": -1,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#FF6AAE",
      "enableShadow": false,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "bounce"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "3d_flip",
    "name": "3D 翻转",
    "description": "翻转入场，适合强调重点",
    "preview": [
      "反转来了",
      "重点出现"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1500,
      "animations": [
        "flip"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "black_white_bilingual",
    "name": "黑白双语",
    "description": "灰色背景框，适合双语字幕",
    "preview": [
      "中文重点",
      "English line"
    ],
    "config": {
      "fontFamily": "黑体",
      "fontSize": 76,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": false,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "solid",
      "backgroundColor": "#333333",
      "backgroundOpacity": 0.72,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1450,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": false
  },
  {
    "id": "yellow_white_bilingual",
    "name": "黄白双语",
    "description": "黄白配色，双语信息层级",
    "preview": [
      "中文重点",
      "English line"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFD700",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": false,
      "strokeWidth": 0,
      "strokeColor": "#000000",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1420,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  },
  {
    "id": "red_white_bilingual",
    "name": "红白双语",
    "description": "红白配色，适合双语字幕",
    "preview": [
      "中文重点",
      "English line"
    ],
    "config": {
      "fontFamily": "微软雅黑",
      "fontSize": 84,
      "fontStyles": [
        "bold"
      ],
      "color": "#FFFFFF",
      "opacity": 1,
      "letterSpacing": 0,
      "enableStroke": true,
      "strokeWidth": 2,
      "strokeColor": "#A30023",
      "enableShadow": true,
      "shadowDistance": 3,
      "shadowColor": "#000000",
      "shadowOpacity": 0.45,
      "backgroundType": "none",
      "backgroundColor": "#000000",
      "backgroundOpacity": 0.7,
      "lineHeight": 1.16,
      "positionX": 540,
      "positionY": 1420,
      "animations": [
        "fade_in"
      ],
      "highlightStyle": {
        "color": "#FFD700",
        "bold": true,
        "underline": false
      }
    },
    "keywordSupported": true
  }
];
export const getSubtitleTemplate=id=>subtitleTemplates.find(t=>t.id===id);
