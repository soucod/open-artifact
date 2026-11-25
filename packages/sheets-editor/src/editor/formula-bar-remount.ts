import * as React from 'react';
import * as ReactDOM from 'react-dom';
export function useFormulaBarRemountKey(isEditing: boolean, isHeld: boolean) {
  let [remountKey, setRemountKey] = React.useState(0);
  let isDueRef = React.useRef(true);
  React.useEffect(() => {
    if (isEditing) isDueRef.current = true;
    if (isEditing || isHeld || !isDueRef.current) return;
    let timer = setTimeout(() => {
      isDueRef.current = false;
      ReactDOM.flushSync(() => setRemountKey((key) => key + 1));
    });
    return () => clearTimeout(timer);
  }, [isEditing, isHeld]);
  return remountKey;
}
