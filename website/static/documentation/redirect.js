"use strict";

const destination = document.getElementById("documentation-destination");
if (destination instanceof HTMLAnchorElement) {
  const url = new URL(destination.href);
  url.search = window.location.search;
  url.hash = window.location.hash;
  destination.href = url.href;
  window.location.replace(url.href);
}
