<script setup>
import {Lightbulb,PencilLine,Volume2,Video,Scissors,Image, Rocket,Grid2X2,ChevronDown,Plus,Link,FileText,FolderOpen,Upload,Download,Play,Pause,X,Minus,Square,Settings,User,Users,House,FlaskConical,List,HelpCircle,Check,Trash2,RefreshCw,Search,ShieldCheck,Mic,SlidersHorizontal,Copy,Layers,Database,Cloud,ArrowLeft,ArrowRight,Save,LoaderCircle,Eye,ImagePlus,CheckCircle2,Music,Type,Maximize2,GripVertical,Monitor,Smartphone,Moon,PaintBucket,Crosshair,MoveHorizontal} from 'lucide-vue-next';
import {Bold,Italic,Underline,AlignLeft,AlignCenter,AlignRight,Star,ExternalLink,Zap,Clock} from 'lucide-vue-next';
import {Inbox,File,ChevronLeft,ChevronRight} from 'lucide-vue-next';
import {CircleAlert,CirclePlay,ChevronUp,CloudUpload} from 'lucide-vue-next';
import {PlayCircleOutlined,PauseCircleOutlined} from '@ant-design/icons-vue';
import {SettingOutlined,RobotOutlined,FormOutlined,DatabaseOutlined,CloudDownloadOutlined,FolderOpenOutlined,ExportOutlined,FullscreenOutlined,FullscreenExitOutlined,LoadingOutlined,BulbOutlined,EditOutlined,SoundOutlined,VideoCameraOutlined,ScissorOutlined,PictureOutlined,RocketOutlined,ThunderboltOutlined} from '@ant-design/icons-vue';
defineProps({name:String,size:{default:20},strokeWidth:{default:1.7}});
const icons={Lightbulb,PencilLine,Volume2,Video,Scissors,Image,Rocket,Grid2X2,ChevronDown,Plus,Link,FileText,FolderOpen,Upload,Download,Play,Pause,X,Minus,Square,Settings,User,Users,House,FlaskConical,List,HelpCircle,Check,Trash2,RefreshCw,Search,ShieldCheck,Mic,SlidersHorizontal,Copy,Layers,Database,Cloud,ArrowLeft,ArrowRight,Save,LoaderCircle,Eye,ImagePlus,CheckCircle2,Music,Type,Maximize2,GripVertical,Monitor,Smartphone,Moon,PaintBucket,Crosshair,MoveHorizontal};
Object.assign(icons,{Bold,Italic,Underline,AlignLeft,AlignCenter,AlignRight,Star,ExternalLink,Zap,Clock});
Object.assign(icons,{Inbox,File,ChevronLeft,ChevronRight});
Object.assign(icons,{CircleAlert,PlayCircle:CirclePlay,ChevronUp,UploadCloud:CloudUpload});
const antIcons={SettingOutlined,RobotOutlined,FormOutlined,DatabaseOutlined,CloudDownloadOutlined,FolderOpenOutlined,ExportOutlined,FullscreenOutlined,FullscreenExitOutlined,LoadingOutlined,BulbOutlined,EditOutlined,SoundOutlined,VideoCameraOutlined,ScissorOutlined,PictureOutlined,RocketOutlined,ThunderboltOutlined};
Object.assign(antIcons,{PlayCircleOutlined,PauseCircleOutlined});
</script>
<template><component v-if="antIcons[name]" :is="antIcons[name]" :style="{fontSize:size+'px',width:size+'px',height:size+'px'}" aria-hidden="true"/><component v-else :is="icons[name]||icons.FileText" :size="size" :stroke-width="strokeWidth" aria-hidden="true" /></template>
