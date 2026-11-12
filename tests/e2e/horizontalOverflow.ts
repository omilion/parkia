/** Detecta scroll horizontal real; las pestañas son el único desborde intencional. */
export function findTableScrollContainers() {
  const containers = [...document.querySelectorAll<HTMLElement>('body *')].filter(element => {
    if (!element.getClientRects().length || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.closest('[role="tablist"]')) return false;
    const style = getComputedStyle(element);
    return ['auto', 'scroll'].includes(style.overflowX) && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
  });
  return containers.map(element => ({
    tag: element.tagName,
    className: element.className,
    width: element.clientWidth,
    contentWidth: element.scrollWidth,
  }));
}
