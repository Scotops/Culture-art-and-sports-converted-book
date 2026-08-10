(function () {
  "use strict";

  function decorateLowercaseA(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf("a") === -1) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent || parent.closest("script, style, .adt-single-storey-a")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var pieces = node.nodeValue.split("a");
      var fragment = document.createDocumentFragment();
      pieces.forEach(function (piece, index) {
        if (piece) fragment.appendChild(document.createTextNode(piece));
        if (index < pieces.length - 1) {
          var glyph = document.createElement("span");
          glyph.className = "adt-single-storey-a";
          glyph.style.fontFamily = '"Times New Roman", Times, serif';
          glyph.style.fontStyle = "italic";
          glyph.style.fontWeight = "400";
          glyph.textContent = "a";
          fragment.appendChild(glyph);
        }
      });
      node.parentNode.replaceChild(fragment, node);
    });
  }

  function apply() {
    decorateLowercaseA(document.getElementById("content"));
  }

  var observer = new MutationObserver(function () { apply(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  apply();
  window.setInterval(apply, 250);
}());
