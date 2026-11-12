import {setHostLocale} from './i18n.js';
import {applyDocumentTheme,applyHostStyleVariables} from '@modelcontextprotocol/ext-apps';

// Initial context and later resize/theme notifications must use the same path.
export function applyHostContext(context={}){
 if(context.locale)setHostLocale(context.locale);
 if(context.theme)applyDocumentTheme(context.theme);
 if(context.styles?.variables)applyHostStyleVariables(context.styles.variables);
 if(context.safeAreaInsets){
  for(const side of ['top','right','bottom','left']){
   const value=context.safeAreaInsets[side];
   if(Number.isFinite(value)&&value>=0)document.documentElement.style.setProperty(`--safe-${side}`,`${value}px`);
  }
 }
}
