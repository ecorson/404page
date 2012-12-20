/**
 * Extending jQuery with autocomplete
 * Version: 1.4.2
 * Author: Yanik Gleyzer (clonyara)
 */
(function($) {

// some key codes
 var RETURN = 13;
 var TAB = 9;
 var ESC = 27;
 var ARRLEFT = 37;
 var ARRUP = 38;
 var ARRRIGHT = 39;
 var ARRDOWN = 40;
 var BACKSPACE = 8;
 var DELETE = 46;
 
function debug(s){
  $('#info').append(htmlspecialchars(s)+'<br>');
}
// getting caret position obj: {start,end}
function getCaretPosition(obj){
  var start = -1;
  var end = -1;
  if(typeof obj.selectionStart != "undefined"){
    start = obj.selectionStart;
    end = obj.selectionEnd;
  }
  else if(document.selection&&document.selection.createRange){
    var M=document.selection.createRange();
    var Lp;
    try{
      Lp = M.duplicate();
      Lp.moveToElementText(obj);
    }catch(e){
      Lp=obj.createTextRange();
    }
    Lp.setEndPoint("EndToStart",M);
    start=Lp.text.length;
    if(start>obj.value.length)
      start = -1;
    
    Lp.setEndPoint("EndToStart",M);
    end=Lp.text.length;
    if(end>obj.value.length)
      end = -1;
  }
  return {'start':start,'end':end};
}
// set caret to
function setCaret(obj,l){
  obj.focus();
  if (obj.setSelectionRange){
    obj.setSelectionRange(l,l);
  }
  else if(obj.createTextRange){
    m = obj.createTextRange();      
    m.moveStart('character',l);
    m.collapse();
    m.select();
  }
}
// prepare array with velued objects
// required properties are id and value
// rest of properties remaines
function prepareArray(jsondata){
  var new_arr = [];
  for(var i=0;i<jsondata.length;i++){
    if(jsondata[i].id != undefined && jsondata[i].value != undefined){
      jsondata[i].id = jsondata[i].id+"";
      jsondata[i].value = jsondata[i].value+"";
      if(jsondata[i].info != undefined)
        jsondata[i].info = jsondata[i].info+"";
      new_arr.push(jsondata[i]);
    }
  }
  return new_arr;
}
// php analogs
function escapearg(s){
  if(s == undefined || !s) return '';
  return s.replace('\\','\\\\').
           replace('*','\\*').
           replace('.','\\.').
           replace('/','\\/');
}
function htmlspecialchars(s){
  if(s == undefined || !s) return '';
  return s.replace('&','&amp;').
           replace('<','&lt;').
           replace('>','&gt;');
}
function ltrim(s){
  if(s == undefined || !s) return '';
  return s.replace(/^\s+/g,'');
}

// extending jQuery
$.fn.autocomplete = function(options){ return this.each(function(){
  // take me
  var me = $(this);
  var me_this = $(this).get(0);

  // test for supported text elements
  if(!me.is('input:text,input:password,textarea'))
  return;

  // get or ajax_get required!
  if(!options && (!$.isFunction(options.get) || !options.ajax_get)){
  return;
  }  
  // check plugin enabled
  if(me.attr('jqac') == 'on') return;

  // plugin on!
  me.attr('jqac','on');

  // no browser's autocomplete!
  me.attr('autocomplete','off');

  // default options
  options = $.extend({ 
                      delay     : 500 ,
                      timeout   : 5000 ,
                      minchars  : 3 ,
                      multi     : false ,
                      cache     : true , 
                      height    : 150 ,
                      autowidth : false ,
                      noresults : 'No results'
                      },
                      options);

  // bind key events
  // handle special keys here
  me.keydown(function(ev){
    switch(ev.which){
      // return choose highlighted item or default propogate
      case RETURN:
        if(!suggestions_menu) return true;
        else setHighlightedValue();
        return false;
      // escape clears menu
      case ESC:
        clearSuggestions();
        return false;
    }
    return true;
  });
  me.keypress(function(ev){
    // ev.which doesn't work here - it always returns 0
    switch(ev.keyCode){
      case RETURN: case ESC:
        return false;
      // up changes highlight
      case ARRUP:
        changeHighlight(ev.keyCode);
        return false;
      // down changes highlight or open new menu
      case ARRDOWN:
        if(!suggestions_menu) getSuggestions(getUserInput());
        else changeHighlight(ev.keyCode);
        return false;
     }
     return true;
  });
  // handle normal characters here
  me.keyup(function(ev) {
      switch(ev.which) {
        case RETURN: case ESC: case ARRLEFT: case ARRRIGHT: case ARRUP: case ARRDOWN:
          return false;
        default:
          getSuggestions(getUserInput());
      }
      return true;
  });

  // init variables
  var user_input = "";
  var input_chars_size  = 0;
  var suggestions = [];
  var current_highlight = 0;
  var suggestions_menu = false;
  var suggestions_list = false;
  var loading_indicator = false;
  var clearSuggestionsTimer = false;
  var getSuggestionsTimer = false;
  var showLoadingTimer = false;
  var zIndex = me.css('z-index');

  // get user input
  function getUserInput(){
    var val = me.val();
    if(options.multi){
      var pos = getCaretPosition(me_this);
      var start = pos.start;
      for(;start>0 && val.charAt(start-1) != ',';start--){}
      var end = pos.start;
      for(;end<val.length && val.charAt(end) != ',';end++){}
      var val = val.substr(start,end-start);
    }
    return ltrim(val);
  }
  // set suggestion
  function setSuggestion(val){
    user_input = val;
    if(options.multi){
      var orig = me.val();
      var pos = getCaretPosition(me_this);
      var start = pos.start;
      for(;start>0 && orig.charAt(start-1) != ',';start--){}
      var end = pos.start;
      for(;end<orig.length && orig.charAt(end) != ',';end++){}
      var new_val = orig.substr(0,start) + (start>0?' ':'') + val + orig.substr(end);
      me.val(new_val);
      setCaret(me_this,start + val.length + (start>0?1:0));
    }
    else{
      me_this.focus();
      me.val(val);
    }
  }
  // get suggestions
  function getSuggestions(val){
    // input length is less than the min required to trigger a request
    // reset input string
    // do nothing
    if (val.length < options.minchars){
      clearSuggestions();
      return false;
    }
    // if caching enabled, and user is typing (ie. length of input is increasing)
    // filter results out of suggestions from last request
    if (options.cache && val.length > input_chars_size && suggestions.length){
      var arr = [];
      for (var i=0;i<suggestions.length;i++){
        var re = new RegExp("("+escapearg(val)+")",'ig');
        if(re.exec(suggestions[i].value))
          arr.push( suggestions[i] );
      }
      user_input = val;
      input_chars_size = val.length;
      suggestions = arr;
      createList(suggestions);
      return false;
    }
    else{// do new request
      clearTimeout(getSuggestionsTimer);
      user_input = val;
      input_chars_size = val.length;
      getSuggestionsTimer = setTimeout( 
        function(){ 
          suggestions = [];
          // call pre callback, if exists
          if($.isFunction(options.pre_callback))
            options.pre_callback();
          // call get
          if($.isFunction(options.get)){
            suggestions = prepareArray(options.get(val));
            createList(suggestions);
          }
          // call AJAX get
          else if($.isFunction(options.ajax_get)){
            clearSuggestions();
            showLoadingTimer = setTimeout(show_loading,options.delay);
            options.ajax_get(val,ajax_continuation);
          }
        },
        options.delay );
    }
    return false;
  };
  // AJAX continuation
  function ajax_continuation(jsondata){
    hide_loading();
    suggestions = prepareArray(jsondata);
    createList(suggestions);
  }
  // shows loading indicator
  function show_loading(){
    if(!loading_indicator){
      loading_indicator = $('<div class="jqac-menu"><div class="jqac-loading">Loading</div></div>').get(0);
      $(loading_indicator).css('position','absolute');
      var pos = me.offset();
      $(loading_indicator).css('left', pos.left + "px");
      $(loading_indicator).css('top', ( pos.top + me.height() + 2 ) + "px");
      if(!options.autowidth)
        $(loading_indicator).width(me.width());
      $('body').append(loading_indicator);
    }
    $(loading_indicator).show();
    setTimeout(hide_loading,10000);
  }
  // hides loading indicator 
  function hide_loading(){
    if(loading_indicator)
      $(loading_indicator).hide();
    clearTimeout(showLoadingTimer);
  }
  // create suggestions list
  function createList(arr){
    if(suggestions_menu)
      $(suggestions_menu).remove();
    hide_loading();
    killTimeout();

    // create holding div
    suggestions_menu = $('<div class="jqac-menu"></div>').get(0);

    // ovveride some necessary CSS properties 
    $(suggestions_menu).css({'position':'absolute',
                             'z-index':zIndex,
                             'max-height':options.height+'px',
                             'overflow-y':'auto'});

    // create and populate ul
    suggestions_list = $('<ul></ul>').get(0);
    // set some CSS's
    $(suggestions_list).
      css('list-style','none').
      css('margin','0px').
      css('padding','2px').
      css('overflow','hidden');
    // regexp for replace 
    var re = new RegExp("("+escapearg(htmlspecialchars(user_input))+")",'ig');
    // loop throught arr of suggestions creating an LI element for each suggestion
    for (var i=0;i<arr.length;i++){
      var val = new String(arr[i].value);
      // using RE
      var output = htmlspecialchars(val).replace(re,'<em>$1</em>');
      // using substr
      //var st = val.toLowerCase().indexOf( user_input.toLowerCase() );
      //var len = user_input.length;
      //var output = val.substring(0,st)+"<em>"+val.substring(st,st+len)+"</em>"+val.substring(st+len);

      var span = $('<span class="jqac-link">'+output+'</span>').get(0);
      if (arr[i].info != undefined && arr[i].info != ""){
        $(span).append($('<div class="jqac-info">'+arr[i].info+'</div>'));
      }

      $(span).attr('name',i+1);
      $(span).click(function () { setHighlightedValue(); });
      $(span).mouseover(function () { setHighlight($(this).attr('name'),true); });

      var li = $('<li></li>').get(0);
      $(li).append(span);

      $(suggestions_list).append(li);
    }

    // no results
    if (arr.length == 0){
      $(suggestions_list).append('<li class="jqac-warning">'+options.noresults+'</li>');
    }

    $(suggestions_menu).append(suggestions_list);

    // get position of target textfield
    // position holding div below it
    // set width of holding div to width of field
    var pos = me.offset();

    $(suggestions_menu).css('left', pos.left + "px");
    $(suggestions_menu).css('top', ( pos.top + me.height() + 2 ) + "px");
    if(!options.autowidth)
      $(suggestions_menu).width(me.width());

    // set mouseover functions for div
    // when mouse pointer leaves div, set a timeout to remove the list after an interval
    // when mouse enters div, kill the timeout so the list won't be removed
    $(suggestions_menu).mouseover(function(){ killTimeout() });
    $(suggestions_menu).mouseout(function(){ resetTimeout() });

    // add DIV to document
    $('body').append(suggestions_menu);

    // bgIFRAME support
    if($.fn.bgiframe)
      $(suggestions_menu).bgiframe({height: suggestions_menu.scrollHeight});


    // adjust height: add +20 for scrollbar
    if(suggestions_menu.scrollHeight > options.height){
      $(suggestions_menu).height(options.height);
      $(suggestions_menu).width($(suggestions_menu).width()+20);
    }
	
    // currently no item is highlighted
    current_highlight = 0;

    // remove list after an interval
    clearSuggestionsTimer = setTimeout(function () { clearSuggestions() }, options.timeout);
  };
  // set highlighted value
  function setHighlightedValue(){
    if(current_highlight && suggestions[current_highlight-1]){
      var sugg = suggestions[ current_highlight-1 ];
      if(sugg.affected_value != undefined && sugg.affected_value != '')
        setSuggestion(sugg.affected_value);
      else
        setSuggestion(sugg.value);
      // pass selected object to callback function, if exists
      if ($.isFunction(options.callback))
        options.callback( suggestions[current_highlight-1] );

      clearSuggestions();
    }
  };
  // change highlight according to key
  function changeHighlight(key){	
    if(!suggestions_list || suggestions.length == 0) return false;
    var n;
    if (key == ARRDOWN)
      n = current_highlight + 1;
    else if (key == ARRUP)
      n = current_highlight - 1;

    if (n > $(suggestions_list).children().size())
      n = 1;
    if (n < 1)
      n = $(suggestions_list).children().size();
    setHighlight(n);
  };
  // change highlight
  function setHighlight(n,mouse_mode){
    if (!suggestions_list) return false;
    if (current_highlight > 0) clearHighlight();
    current_highlight = Number(n);
    var li = $(suggestions_list).children().get(current_highlight-1);
    li.className = 'jqac-highlight';
    // for mouse mode don't adjust scroll! prevent scrolling jumps
    if(!mouse_mode) adjustScroll(li);
    killTimeout();
  };
  // clear highlight
  function clearHighlight(){
    if (!suggestions_list)return false;
    if (current_highlight > 0){
      $(suggestions_list).children().get(current_highlight-1).className = '';
      current_highlight = 0;
    }
  };
  // clear suggestions list
  function clearSuggestions(){
    killTimeout();
    if(suggestions_menu){
      $(suggestions_menu).remove();
      suggestions_menu = false;
      suggestions_list = false;
      current_highlight = 0;
    }
  };
  // set scroll
  function adjustScroll(el){
    if(!suggestions_menu) return false;
    var viewportHeight = suggestions_menu.clientHeight;        
    var wholeHeight = suggestions_menu.scrollHeight;
    var scrolled = suggestions_menu.scrollTop;
    var elTop = el.offsetTop;
    var elBottom = elTop + el.offsetHeight;
    if(elBottom > scrolled + viewportHeight){
      suggestions_menu.scrollTop = elBottom - viewportHeight;
    }
    else if(elTop < scrolled){
      suggestions_menu.scrollTop = elTop;
    }
    return true; 
  }
  // timeout funcs
  function killTimeout(){
    clearTimeout(clearSuggestionsTimer);
  };
  function resetTimeout(){
    clearTimeout(clearSuggestionsTimer);
    clearSuggestionsTimer = setTimeout(function () { clearSuggestions() }, 1000);
  };

})};

})($);

jQuery.autocomplete = function(input, options) {
	// Create a link to self
	var me = this;

	// Create jQuery object for input element
	var $input = $(input).attr("autocomplete", "off");

	// Apply inputClass if necessary
	if (options.inputClass) $input.addClass(options.inputClass);

	// Create results
	var results = document.createElement("div");
	// Create jQuery object for results
	var $results = $(results);
	$results.hide().addClass(options.resultsClass).css("position", "absolute");
	if( options.width > 0 ) $results.css("width", options.width);

	// Add to body element
	$("body").append(results);

	input.autocompleter = me;

	var timeout = null;
	var prev = "";
	var active = -1;
	var cache = {};
	var keyb = false;
	var hasFocus = false;
	var lastKeyPressCode = null;

	// flush cache
	function flushCache(){
		cache = {};
		cache.data = {};
		cache.length = 0;
	};

	// flush cache
	flushCache();

	// if there is a data array supplied
	if( options.data != null ){
		var sFirstChar = "", stMatchSets = {}, row = [];

		// no url was specified, we need to adjust the cache length to make sure it fits the local data store
		if( typeof options.url != "string" ) options.cacheLength = 1;

		// loop through the array and create a lookup structure
		for( var i=0; i < options.data.length; i++ ){
			// if row is a string, make an array otherwise just reference the array
			row = ((typeof options.data[i] == "string") ? [options.data[i]] : options.data[i]);

			// if the length is zero, don't add to list
			if( row[0].length > 0 ){
				// get the first character
				sFirstChar = row[0].substring(0, 1).toLowerCase();
				// if no lookup array for this character exists, look it up now
				if( !stMatchSets[sFirstChar] ) stMatchSets[sFirstChar] = [];
				// if the match is a string
				stMatchSets[sFirstChar].push(row);
			}
		}

		// add the data items to the cache
		for( var k in stMatchSets ){
			// increase the cache size
			options.cacheLength++;
			// add to the cache
			addToCache(k, stMatchSets[k]);
		}
	}

	$input
	.keydown(function(e) {
		// track last key pressed
		lastKeyPressCode = e.keyCode;
		switch(e.keyCode) {
			case 38: // up
				e.preventDefault();
				moveSelect(-1);
				break;
			case 40: // down
				e.preventDefault();
				moveSelect(1);
				break;
			case 9:  // tab
			case 13: // return
				if( selectCurrent() ){
					// make sure to blur off the current field
					$input.get(0).blur();
					e.preventDefault();
				}
				break;
			default:
				active = -1;
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(function(){onChange();}, options.delay);
				break;
		}
	})
	.focus(function(){
		// track whether the field has focus, we shouldn't process any results if the field no longer has focus
		hasFocus = true;
	})
	.blur(function() {
		// track whether the field has focus
		hasFocus = false;
		hideResults();
	});

	hideResultsNow();

	function onChange() {
		// ignore if the following keys are pressed: [del] [shift] [capslock]
		if( lastKeyPressCode == 46 || (lastKeyPressCode > 8 && lastKeyPressCode < 32) ) return $results.hide();
		var v = $input.val();
		if (v == prev) return;
		prev = v;
		if (v.length >= options.minChars) {
			$input.addClass(options.loadingClass);
			requestData(v);
		} else {
			$input.removeClass(options.loadingClass);
			$results.hide();
		}
	};

 	function moveSelect(step) {

		var lis = $("li", results);
		if (!lis) return;

		active += step;

		if (active < 0) {
			active = 0;
		} else if (active >= lis.size()) {
			active = lis.size() - 1;
		}

		lis.removeClass("ac_over");

		$(lis[active]).addClass("ac_over");

		// Weird behaviour in IE
		// if (lis[active] && lis[active].scrollIntoView) {
		// 	lis[active].scrollIntoView(false);
		// }

	};

	function selectCurrent() {
		var li = $("li.ac_over", results)[0];
		if (!li) {
			var $li = $("li", results);
			if (options.selectOnly) {
				if ($li.length == 1) li = $li[0];
			} else if (options.selectFirst) {
				li = $li[0];
			}
		}
		if (li) {
			selectItem(li);
			return true;
		} else {
			return false;
		}
	};

	function selectItem(li) {
		if (!li) {
			li = document.createElement("li");
			li.extra = [];
			li.selectValue = "";
		}
		var v = $.trim(li.selectValue ? li.selectValue : li.innerHTML);
		input.lastSelected = v;
		prev = v;
		$results.html("");
		$input.val(v);
		hideResultsNow();
		if (options.onItemSelect) setTimeout(function() { options.onItemSelect(li) }, 1);
	};

	// selects a portion of the input string
	function createSelection(start, end){
		// get a reference to the input element
		var field = $input.get(0);
		if( field.createTextRange ){
			var selRange = field.createTextRange();
			selRange.collapse(true);
			selRange.moveStart("character", start);
			selRange.moveEnd("character", end);
			selRange.select();
		} else if( field.setSelectionRange ){
			field.setSelectionRange(start, end);
		} else {
			if( field.selectionStart ){
				field.selectionStart = start;
				field.selectionEnd = end;
			}
		}
		field.focus();
	};

	// fills in the input box w/the first match (assumed to be the best match)
	function autoFill(sValue){
		// if the last user key pressed was backspace, don't autofill
		if( lastKeyPressCode != 8 ){
			// fill in the value (keep the case the user has typed)
			$input.val($input.val() + sValue.substring(prev.length));
			// select the portion of the value not typed by the user (so the next character will erase)
			createSelection(prev.length, sValue.length);
		}
	};

	function showResults() {
		// get the position of the input field right now (in case the DOM is shifted)
		var pos = findPos(input);
		// either use the specified width, or autocalculate based on form element
		var iWidth = (options.width > 0) ? options.width : $input.width();
		// reposition
		$results.css({
			width: parseInt(iWidth) + "px",
			top: (pos.y + input.offsetHeight) + "px",
			left: pos.x + "px"
		}).show();
	};

	function hideResults() {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(hideResultsNow, 200);
	};

	function hideResultsNow() {
		if (timeout) clearTimeout(timeout);
		$input.removeClass(options.loadingClass);
		if ($results.is(":visible")) {
			$results.hide();
		}
		if (options.mustMatch) {
			var v = $input.val();
			if (v != input.lastSelected) {
				selectItem(null);
			}
		}
	};

	function receiveData(q, data) {
		if (data) {
			$input.removeClass(options.loadingClass);
			results.innerHTML = "";

			// if the field no longer has focus or if there are no matches, do not display the drop down
			if( !hasFocus || data.length == 0 ) return hideResultsNow();

			if ($.browser.msie) {
				// we put a styled iframe behind the calendar so HTML SELECT elements don't show through
				$results.append(document.createElement('iframe'));
			}
			results.appendChild(dataToDom(data));
			// autofill in the complete box w/the first match as long as the user hasn't entered in more data
			if( options.autoFill && ($input.val().toLowerCase() == q.toLowerCase()) ) autoFill(data[0][0]);
			showResults();
		} else {
			hideResultsNow();
		}
	};

	function parseData(data) {
		if (!data) return null;
		var parsed = [];
		var rows = data.split(options.lineSeparator);
		for (var i=0; i < rows.length; i++) {
			var row = $.trim(rows[i]);
			if (row) {
				parsed[parsed.length] = row.split(options.cellSeparator);
			}
		}
		return parsed;
	};

	function dataToDom(data) {
		var ul = document.createElement("ul");
		var num = data.length;

		// limited results to a max number
		if( (options.maxItemsToShow > 0) && (options.maxItemsToShow < num) ) num = options.maxItemsToShow;

		for (var i=0; i < num; i++) {
			var row = data[i];
			if (!row) continue;
			var li = document.createElement("li");
			if (options.formatItem) {
				li.innerHTML = options.formatItem(row, i, num);
				li.selectValue = row[0];
			} else {
				li.innerHTML = row[0];
				li.selectValue = row[0];
			}
			var extra = null;
			if (row.length > 1) {
				extra = [];
				for (var j=1; j < row.length; j++) {
					extra[extra.length] = row[j];
				}
			}
			li.extra = extra;
			ul.appendChild(li);
			$(li).hover(
				function() { $("li", ul).removeClass("ac_over"); $(this).addClass("ac_over"); active = $("li", ul).indexOf($(this).get(0)); },
				function() { $(this).removeClass("ac_over"); }
			).click(function(e) { e.preventDefault(); e.stopPropagation(); selectItem(this) });
		}
		return ul;
	};

	function requestData(q) {
		if (!options.matchCase) q = q.toLowerCase();
		var data = options.cacheLength ? loadFromCache(q) : null;
		// recieve the cached data
		if (data) {
			receiveData(q, data);
		// if an AJAX url has been supplied, try loading the data now
		} else if( (typeof options.url == "string") && (options.url.length > 0) ){
			$.get(makeUrl(q), function(data) {
				data = parseData(data);
				addToCache(q, data);
				receiveData(q, data);
			});
		// if there's been no data found, remove the loading class
		} else {
			$input.removeClass(options.loadingClass);
		}
	};

	function makeUrl(q) {
		var url = options.url + "?q=" + encodeURI(q);
		for (var i in options.extraParams) {
			url += "&" + i + "=" + encodeURI(options.extraParams[i]);
		}
		return url;
	};

	function loadFromCache(q) {
		if (!q) return null;
		if (cache.data[q]) return cache.data[q];
		if (options.matchSubset) {
			for (var i = q.length - 1; i >= options.minChars; i--) {
				var qs = q.substr(0, i);
				var c = cache.data[qs];
				if (c) {
					var csub = [];
					for (var j = 0; j < c.length; j++) {
						var x = c[j];
						var x0 = x[0];
						if (matchSubset(x0, q)) {
							csub[csub.length] = x;
						}
					}
					return csub;
				}
			}
		}
		return null;
	};

	function matchSubset(s, sub) {
		if (!options.matchCase) s = s.toLowerCase();
		var i = s.indexOf(sub);
		if (i == -1) return false;
		return i == 0 || options.matchContains;
	};

	this.flushCache = function() {
		flushCache();
	};

	this.setExtraParams = function(p) {
		options.extraParams = p;
	};

	this.findValue = function(){
		var q = $input.val();

		if (!options.matchCase) q = q.toLowerCase();
		var data = options.cacheLength ? loadFromCache(q) : null;
		if (data) {
			findValueCallback(q, data);
		} else if( (typeof options.url == "string") && (options.url.length > 0) ){
			$.get(makeUrl(q), function(data) {
				data = parseData(data)
				addToCache(q, data);
				findValueCallback(q, data);
			});
		} else {
			// no matches
			findValueCallback(q, null);
		}
	}

	function findValueCallback(q, data){
		if (data) $input.removeClass(options.loadingClass);

		var num = (data) ? data.length : 0;
		var li = null;

		for (var i=0; i < num; i++) {
			var row = data[i];

			if( row[0].toLowerCase() == q.toLowerCase() ){
				li = document.createElement("li");
				if (options.formatItem) {
					li.innerHTML = options.formatItem(row, i, num);
					li.selectValue = row[0];
				} else {
					li.innerHTML = row[0];
					li.selectValue = row[0];
				}
				var extra = null;
				if( row.length > 1 ){
					extra = [];
					for (var j=1; j < row.length; j++) {
						extra[extra.length] = row[j];
					}
				}
				li.extra = extra;
			}
		}

		if( options.onFindValue ) setTimeout(function() { options.onFindValue(li) }, 1);
	}

	function addToCache(q, data) {
		if (!data || !q || !options.cacheLength) return;
		if (!cache.length || cache.length > options.cacheLength) {
			flushCache();
			cache.length++;
		} else if (!cache[q]) {
			cache.length++;
		}
		cache.data[q] = data;
	};

	function findPos(obj) {
		var curleft = obj.offsetLeft || 0;
		var curtop = obj.offsetTop || 0;
		while (obj = obj.offsetParent) {
			curleft += obj.offsetLeft
			curtop += obj.offsetTop
		}
		return {x:curleft,y:curtop};
	}
}

jQuery.fn.autocomplete = function(url, options, data) {
	// Make sure options exists
	options = options || {};
	// Set url as option
	options.url = url;
	// set some bulk local data
	options.data = ((typeof data == "object") && (data.constructor == Array)) ? data : null;

	// Set default values for required options
	options.inputClass = options.inputClass || "ac_input";
	options.resultsClass = options.resultsClass || "ac_results";
	options.lineSeparator = options.lineSeparator || "\n";
	options.cellSeparator = options.cellSeparator || "|";
	options.minChars = options.minChars || 1;
	options.delay = options.delay || 400;
	options.matchCase = options.matchCase || 0;
	options.matchSubset = options.matchSubset || 1;
	options.matchContains = options.matchContains || 0;
	options.cacheLength = options.cacheLength || 1;
	options.mustMatch = options.mustMatch || 0;
	options.extraParams = options.extraParams || {};
	options.loadingClass = options.loadingClass || "ac_loading";
	options.selectFirst = options.selectFirst || false;
	options.selectOnly = options.selectOnly || false;
	options.maxItemsToShow = options.maxItemsToShow || -1;
	options.autoFill = options.autoFill || false;
	options.width = parseInt(options.width, 10) || 0;

	this.each(function() {
		var input = this;
		new jQuery.autocomplete(input, options);
	});

	// Don't break the chain
	return this;
}

jQuery.fn.autocompleteArray = function(data, options) {
	return this.autocomplete(null, options, data);
}

jQuery.fn.indexOf = function(e){
	for( var i=0; i<this.length; i++ ){
		if( this[i] == e ) return i;
	}
	return -1;
};

