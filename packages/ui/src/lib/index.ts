// Exports shared components, layout shells and Lucide icons
// Form and action controls
export { Button, buttonVariants } from './components/ui/button/index.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/ui/button/index.js';
export { Input } from './components/ui/input/index.js';
export { Textarea } from './components/ui/textarea/index.js';

// Shared application shells
export { default as ModuleLanding } from './ModuleLanding.svelte';
export { default as AppHeader } from './AppHeader.svelte';
export { default as ThemeProvider } from './ThemeProvider.svelte';
export { default as ThemeToggle } from './ThemeToggle.svelte';
export { default as AgordojLink } from './AgordojLink.svelte';
export { default as ThemePicker } from './ThemePicker.svelte';
export { withIdentityAppearance } from './themes/identity-appearance.js';

// Composite interaction components
export * as Dialog from './components/ui/dialog/index.js';
export * as AlertDialog from './components/ui/alert-dialog/index.js';
export * as ContextMenu from './components/ui/context-menu/index.js';
export * as DropdownMenu from './components/ui/dropdown-menu/index.js';
export * as Message from './components/ui/message/index.js';
export * as Bubble from './components/ui/bubble/index.js';
export * as Attachment from './components/ui/attachment/index.js';
export * as Avatar from './components/ui/avatar/index.js';

// Navigation and account icons
export { default as ArrowUpRightIcon } from '@lucide/svelte/icons/arrow-up-right';
export { default as ArrowRightIcon } from '@lucide/svelte/icons/arrow-right';
export { default as ChevronLeftIcon } from '@lucide/svelte/icons/chevron-left';
export { default as ChevronRightIcon } from '@lucide/svelte/icons/chevron-right';
export { default as EllipsisIcon } from '@lucide/svelte/icons/ellipsis';
export { default as XIcon } from '@lucide/svelte/icons/x';
export { default as ShieldCheckIcon } from '@lucide/svelte/icons/shield-check';
export { default as KeyRoundIcon } from '@lucide/svelte/icons/key-round';
export { default as LogOutIcon } from '@lucide/svelte/icons/log-out';

// Post and message icons
export { default as MessageCircleIcon } from '@lucide/svelte/icons/message-circle';
export { default as ThumbsUpIcon } from '@lucide/svelte/icons/thumbs-up';
export { default as ThumbsDownIcon } from '@lucide/svelte/icons/thumbs-down';
export { default as Repeat2Icon } from '@lucide/svelte/icons/repeat-2';
export { default as ImagePlusIcon } from '@lucide/svelte/icons/image-plus';
export { default as PlusIcon } from '@lucide/svelte/icons/plus';
export { default as PlayIcon } from '@lucide/svelte/icons/play';
export { default as Trash2Icon } from '@lucide/svelte/icons/trash-2';
export { default as BoldIcon } from '@lucide/svelte/icons/bold';
export { default as ItalicIcon } from '@lucide/svelte/icons/italic';
export { default as StrikethroughIcon } from '@lucide/svelte/icons/strikethrough';

// Ligo and Rondo icons
export { default as HouseIcon } from '@lucide/svelte/icons/house';
export { default as SearchIcon } from '@lucide/svelte/icons/search';
export { default as BellIcon } from '@lucide/svelte/icons/bell';
export { default as BookmarkIcon } from '@lucide/svelte/icons/bookmark';
export { default as UserRoundIcon } from '@lucide/svelte/icons/user-round';
export { default as SettingsIcon } from '@lucide/svelte/icons/settings';
export { default as SendIcon } from '@lucide/svelte/icons/send';
export { default as PaperclipIcon } from '@lucide/svelte/icons/paperclip';
export { default as UsersIcon } from '@lucide/svelte/icons/users';
export { default as UserPlusIcon } from '@lucide/svelte/icons/user-plus';
export { default as CheckIcon } from '@lucide/svelte/icons/check';
export { default as CheckCheckIcon } from '@lucide/svelte/icons/check-check';
export { default as CircleIcon } from '@lucide/svelte/icons/circle';
export { default as HashIcon } from '@lucide/svelte/icons/hash';
export { default as MicIcon } from '@lucide/svelte/icons/mic';
export { default as MicOffIcon } from '@lucide/svelte/icons/mic-off';
export { default as VideoIcon } from '@lucide/svelte/icons/video';
export { default as VideoOffIcon } from '@lucide/svelte/icons/video-off';
export { default as MonitorUpIcon } from '@lucide/svelte/icons/monitor-up';
export { default as MonitorOffIcon } from '@lucide/svelte/icons/monitor-off';
export { default as Volume2Icon } from '@lucide/svelte/icons/volume-2';
export { default as VolumeXIcon } from '@lucide/svelte/icons/volume-x';
export { default as HeadphoneOffIcon } from '@lucide/svelte/icons/headphone-off';
export { default as HeadphonesIcon } from '@lucide/svelte/icons/headphones';
export { default as Maximize2Icon } from '@lucide/svelte/icons/maximize-2';
export { default as Minimize2Icon } from '@lucide/svelte/icons/minimize-2';
export { default as PanelLeftIcon } from '@lucide/svelte/icons/panel-left';
export { default as PanelRightIcon } from '@lucide/svelte/icons/panel-right';
export { default as LayoutGridIcon } from '@lucide/svelte/icons/layout-grid';
export { default as CompassIcon } from '@lucide/svelte/icons/compass';
export { default as HeartIcon } from '@lucide/svelte/icons/heart';
export { default as SmilePlusIcon } from '@lucide/svelte/icons/smile-plus';
export { default as PencilIcon } from '@lucide/svelte/icons/pencil';
export { default as LoaderCircleIcon } from '@lucide/svelte/icons/loader-circle';
export { default as WifiOffIcon } from '@lucide/svelte/icons/wifi-off';
export { default as FileIcon } from '@lucide/svelte/icons/file';

export * as HoverCard from './components/ui/hover-card/index.js';
export * as Popover from './components/ui/popover/index.js';
export * as RadioGroup from './components/ui/radio-group/index.js';
export { Progress } from './components/ui/progress/index.js';
export { default as InfoIcon } from '@lucide/svelte/icons/info';
export { default as HardDriveIcon } from '@lucide/svelte/icons/hard-drive';
export { default as UsbIcon } from '@lucide/svelte/icons/usb';
export { default as ServerIcon } from '@lucide/svelte/icons/server';
