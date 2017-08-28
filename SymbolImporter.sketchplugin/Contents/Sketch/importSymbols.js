const FILE_TYPE = 'com.bohemiancoding.sketch.drawing';
const FILE_EXTENSIONS = ['sketch'];
const FILE_SELECTION_TEXT = 'Select a Sketch document to import symbols from.';
const FILE_SELECTION_ERROR = 'Could not open file. Is it a Sketch file?';

var command;
var fromDoc;
var replaceBy = 'id';
var addCount = 0;
var updateCount = 0;

/**
 * Open a file prompt.
 * @return {NSOpenPanel}
 */
function openPrompt() {
  var panel = NSOpenPanel.openPanel();
  panel.setCanChooseFiles(true);
  panel.setAllowedFileTypes(FILE_EXTENSIONS);
  panel.setCanChooseDirectories(false);
  panel.setAllowsMultipleSelection(false);
  panel.setCanCreateDirectories(false);
  panel.setTitle(FILE_SELECTION_TEXT);
  return panel;
}

/**
 * Attempt to open a file if it is of the proper type.
 * @param {String} url
 * @return {MSDocument|nil}
 */
function tryToOpenFile(url) {
  var doc = MSDocument.new();
  if (doc.readFromURL_ofType_error(url, FILE_TYPE, nil)) return doc;
  return nil;
}

/**
 * Attempt to close a file if one is passed.
 * @param {MSDocument|nil} doc
 */
function tryToCloseFile(doc) {
  if (!doc) return;
  doc.close();
  doc = nil;
}

/**
 * Find symbols inside of a symbol.
 * @param  {MSSymbolInstance|MSSymbolMaster}
 * @return {NSMutableArray}
 */
function findSymbols(symbol) {

  symbol = symbol.className().isEqualToString('MSSymbolInstance') ? symbol.symbolMaster() : symbol;

  var arr = [[NSMutableArray new] init];
  var arr2;
  var layers = symbol.layers();
  var i = 0;
  var len = layers.count();
  var className;

  for (; i < len; i++) {
    className = layers[i].className();
    if (className.isEqualToString('MSSymbolInstance')) {
      arr.push(layers[i].symbolMaster());
    }
    else if (className.isEqualToString('MSLayerGroup')) {
      arr2 = findSymbols(layers[i]);
      [arr addObjectsFromArray:arr2];
    }
  }
  
  return arr;
}

/**
 * Take an array of symbols and map it to a data structure we can do to insert them in an appropriate order.
 * @param  {NSMutableArray<MSSymbolMaster>}
 * @return {Array}
 */
function mapSymbols(symbols) {
  
  var ret = [];
  var i = 0;
  var len = symbols.count();
  var key;
  
  for (; i < len; i++) {
    key = getSymbolKey(symbols[i]);
    ret.push({
      id: '' + key,
      symbol: symbols[i],
      nestedSymbols: mapSymbols(findSymbols(symbols[i]))
    });
  }

  return ret;
}

/**
 * Get a unique identifier for a symbol.
 * @param  {NSSymbolInstance}
 * @return {String}
 */
function getSymbolKey(symbol) {
  return replaceBy === 'id' ? symbol.symbolID() : symbol.name();
}

/**
 * Sort symbols so that symbols with other symbols inside them are later in the list.
 * @param  {Array<Object>}
 * @return {Array<Object>}
 */
function sortSymbols(symbols) {
  return symbols.sort((a, b) => {
    if (containsSymbol(a, b.id)) return 1;
    if (containsSymbol(b, a.id)) return -1;
    return 0;
  });
}

/**
 * Does one symbol contain another?
 * @param  {Object}
 * @param  {String}
 * @return {Boolean}
 */
function containsSymbol(symbol, id) {
  return symbol.nestedSymbols.find((s) => {
    if (s.id === id || containsSymbol(s, id)) return true;
  });
}

/**
 * Add an array of symbols to the document.
 * @param {NSDocument}
 * @param {Array}
 */
function addSymbols(doc, symbols) {
  symbols.forEach((symbol) => {
    var existingSymbol = getSymbol(doc.documentData().allSymbols(), symbol.id);
    if (existingSymbol) {
      updateSymbol(doc, existingSymbol, symbol);
    }
    else {
      addSymbol(doc, symbol);
    }
    // we don't need to do this since we're not cloning the symbols any more
    // @todo: make sure there are no side effects.
    // linkNestedSymbols(doc, symbol);
  });
}

/**
 * Insert a symbol into the document.
 * @param {NSDocument}
 * @param {NSSymbolMaster}
 */
function addSymbol(doc, symbol) {
  // var clonedSymbol = cloneSymbol(symbol.symbol);
  storeSymbolData(symbol.symbol);
  insertSymbolAtPosition(getSymbolPage(doc, symbol.symbol), symbol.symbol, getSymbolPosition(symbol.symbol));
  addCount++;
}

/**
 * Update a symbol by replacing it with another.
 * @param {NSDocument}
 * @param  {NSSymbolMaster}
 * @param  {NSSymbolMaster}
 */
function updateSymbol(doc, existingSymbol, symbol) {
  storeSymbolData(symbol.symbol);
  insertSymbolAtPosition(getSymbolPage(doc, symbol.symbol), symbol.symbol, getSymbolPosition(existingSymbol));
  updateSymbolInstances(existingSymbol, symbol.symbol);
  removeSymbol(existingSymbol);
  updateCount++;
}

/**
 * Remove a symbol from the document.
 * @param {MSSymbolMaster} symbol
 */
function removeSymbol(symbol) {
  symbol.removeFromParent();
  symbol = nil;
}

/**
 * Insert a symbol at a given set of coordinates
 * @param {MSPage} page
 * @param {MSSymbolMaster} symbol
 * @param {Object} position
 */
function insertSymbolAtPosition(page, symbol, position) {
  var rect = symbol.rect();
  rect.origin.x = position.x;
  rect.origin.y = position.y;
  symbol.rect = rect;
  insertSymbol(page, symbol);
}

/**
 * Insert a symbol into the document.
 * @param {MSPage} page
 * @param {MSSymbolMaster} symbol
 * @return {MSSymbolMaster}
 */
function insertSymbol(page, symbol) {
  page.addLayers([symbol]);
  return symbol;
}

/**
 * Store the import ID and name for a symbol.
 * @param {MSSymbolMaster} symbol
 */
function storeSymbolData(symbol) {
  setLayerValue(symbol, 'import_id', symbol.symbolID());
  setLayerValue(symbol, 'import_name', symbol.name());
}

/**
 * Get the page a symbol belongs to, creating it if it doesn't exist.
 * @param  {MSDocument} doc    
 * @param  {MSSymbolMaster} symbol 
 * @return {MSPage}        
 */
function getSymbolPage(doc, symbol) {
  var name = symbol.parentPage().name();
  return getPage(doc, name) || createPage(doc, name);
}

/**
 * Get a page by name.
 * @param  {MSDocument} doc    
 * @param  {MSSymbolMaster} symbol 
 * @return {MSPage|null} 
 */
function getPage(doc, name) {
  var pages = doc.pages();
  var i = 0;
  var len = pages.count();
  for (; i < len; i++) {
    if (pages.objectAtIndex(i).name() === name) {
      return pages.objectAtIndex(i);
    }
  }
  return null;
}

/**
 * Create a page by name.
 * @param  {MSDocument} doc    
 * @param  {String} name 
 * @return {MSPage} 
 */
function createPage(doc, name) {
  var page = doc.addBlankPage();
  page.setName(name);
  return page;
}

/**
 * Store an arbitrary value on a layer.
 * @param {Mixed} layer
 * @param {String} name
 * @param {String} val
 */
function setLayerValue(layer, name, val) {
  return command.setValue_forKey_onLayer(val, name, layer);
}

/**
 * Get an arbitrary value from a layer.
 * @param  {Mixed} layer
 * @param  {String} name
 * @return {String}
 */
function getLayerValue(layer, name) {
  return command.valueForKey_onLayer(name, layer) || [NSString new];
}

/**
 * If Symbols page exists, switch to it, otherwise create it then switch to it.
 * @param {MSDocument} doc
 */
function showSymbolsPage(doc) {
  doc.setCurrentPage(doc.documentData().symbolsPageOrCreateIfNecessary());
}
/**
 * Get the coordinates of a symbol.
 * @param {MSSymbolMaster} symbol
 * @return {Object}
 */
function getSymbolPosition(symbol) {
  var rect = symbol.rect();
  return {
    x: rect.origin.x,
    y: rect.origin.y
  };
}

/**
 * Update instances of a symbol to use another as their master.
 * @param {MSSymbolMaster} oldSymbol
 * @param {MSSymbolMaster} newSymbol
 */
function updateSymbolInstances(oldSymbol, newSymbol) {
  var instances = oldSymbol.allInstances();
  var i = 0;
  var len = instances.count();
  for (; i < len; i++) {
    instances.objectAtIndex(i).changeInstanceToSymbol(newSymbol);
  }
  oldSymbol.removeFromParent();
}

/**
 * Get a symbol from a list by ID.
 * @param  {NSMutableArray}
 * @param  {String}
 * @return {NSSymbolMaster|Boolean}
 */
function getSymbol(symbols, id) {
  var ret = [];
  var i = 0;
  var len = symbols.count();
  for (; i < len; i++) {
    if (getLayerValue(symbols.objectAtIndex(i), 'import_' + replaceBy).isEqualToString(id)) return symbols.objectAtIndex(i);
  }
  return false;
}

/**
 * Link all symbols inside of another.
 * @todo Can we remove this?
 * @param {NSDocument}
 * @param  {NSSymbolMaster}
 */
function linkNestedSymbols(doc, symbol) {
  if (!symbol.nestedSymbols.length) return;
  symbol.nestedSymbols.forEach(linkNestedSymbol);
}

/**
 * Link a symbol to another symbol in the document with the same ID.
 * @todo Can we remove this?
 * @param {NSDocument}
 * @param  {NSSymbolInstance}
 */
function linkNestedSymbol(doc, symbol) {
  var toSymbols = doc.documentData().allSymbols();
  symbol.symbol.changeInstanceToSymbol(getSymbol(toSymbols, getSymbolKey(symbol.symbol)).symbol);
  linkNestedSymbols(symbol);
}

/**
 * Start the import process.
 * @param {MSDocument} t
 * @param {MSDocument} f
 */
function startImport(toDoc, fromDoc) {
  addSymbols(toDoc, sortSymbols(mapSymbols(fromDoc.documentData().allSymbols())));
  showSymbolsPage(toDoc);
  toDoc.showMessage(addCount + ' ' + (addCount === 1 ? 'symbol' : 'symbols') + ' added, ' + updateCount + ' updated.');
}

/**
 * Import symbols.
 * @param {Object} context
 */
function importSymbols(context) {

  // Prompt for a file
  var panel = openPrompt();
  if (panel.runModal() !== NSOKButton) return;
  var fileURL = panel.URL();

  command = context.command;

  // Try to open the file, get its symbols, add them to the current document, then close the file.
  var doc;
  if (doc = tryToOpenFile(fileURL)) startImport(context.document, doc);
  else context.document.showMessage(FILE_SELECTION_ERROR);
  tryToCloseFile(doc);
}

/**
 * Import symbols by ID.
 * @param {Object} context
 */
function importSymbolsByID(context) {
  importSymbols(context);
}

/**
 * Import symbols by name.
 * @param {Object} context
 */
function importSymbolsByName(context) {
  replaceBy = 'name';
  importSymbols(context);
}
