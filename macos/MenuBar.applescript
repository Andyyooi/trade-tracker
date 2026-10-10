use framework "Foundation"
use framework "AppKit"
use scripting additions

property statusItem : missing value
property todayItem : missing value
property weekItem : missing value
property monthItem : missing value
property allItem : missing value
property statsItem : missing value

on run
	set nsApp to current application's NSApplication's sharedApplication()
	nsApp's setActivationPolicy:(current application's NSApplicationActivationPolicyAccessory)
	my setupStatusItem()
	my refreshDisplay_(missing value)
	current application's NSTimer's scheduledTimerWithTimeInterval:5 target:me selector:"refreshDisplay:" userInfo:(missing value) repeats:true
	nsApp's performSelector:"run"
end run

on setupStatusItem()
	set statusItem to current application's NSStatusBar's systemStatusBar()'s statusItemWithLength:(current application's NSVariableStatusItemLength)
	statusItem's button()'s setTitle:"P&L"
	set theMenu to current application's NSMenu's alloc()'s init()
	theMenu's setAutoenablesItems:false
	
	set todayItem to my addLabelItem(theMenu, "Today")
	set weekItem to my addLabelItem(theMenu, "This week")
	set monthItem to my addLabelItem(theMenu, "This month")
	set allItem to my addLabelItem(theMenu, "All imported")
	theMenu's addItem:(current application's NSMenuItem's separatorItem())
	set statsItem to my addLabelItem(theMenu, "Win rate")
	theMenu's addItem:(current application's NSMenuItem's separatorItem())
	
	set dashItem to current application's NSMenuItem's alloc()'s initWithTitle:"Open dashboard" action:"openDashboard:" keyEquivalent:""
	dashItem's setTarget:me
	theMenu's addItem:dashItem
	
	set quitItem to current application's NSMenuItem's alloc()'s initWithTitle:"Quit Trade Tracker" action:"quitApp:" keyEquivalent:"q"
	quitItem's setTarget:me
	theMenu's addItem:quitItem
	
	statusItem's setMenu:theMenu
end setupStatusItem

on addLabelItem(theMenu, theTitle)
	set menuItem to current application's NSMenuItem's alloc()'s initWithTitle:theTitle action:(missing value) keyEquivalent:""
	menuItem's setEnabled:true
	theMenu's addItem:menuItem
	return menuItem
end addLabelItem

on refreshDisplay_(sender)
	try
		set stats to my computeStats()
		my colourBar_amount_(statusItem, (stats's objectForKey:"todayPnl") as real)
		my colourItem_label_amount_(todayItem, "Today", (stats's objectForKey:"todayPnl") as real)
		my colourItem_label_amount_(weekItem, "This week", (stats's objectForKey:"weekPnl") as real)
		my colourItem_label_amount_(monthItem, "This month", (stats's objectForKey:"monthPnl") as real)
		my colourItem_label_amount_(allItem, "All imported", (stats's objectForKey:"allPnl") as real)
		statsItem's setTitle:(stats's objectForKey:"statsLabel")
	on error errMsg
		try
			statusItem's button()'s setTitle:"P&L ?"
			(current application's NSString's stringWithString:errMsg)'s writeToFile:"/Users/andyyooi/trade-tracker/macos/menubar.log" atomically:true encoding:(current application's NSUTF8StringEncoding) |error|:(missing value)
		end try
	end try
end refreshDisplay_

on computeStats()
	set raw to do shell script "/usr/bin/ruby " & quoted form of "/Users/andyyooi/trade-tracker/macos/menu_stats.rb"
	set nsRaw to current application's NSString's stringWithString:raw
	set jsonData to nsRaw's dataUsingEncoding:(current application's NSUTF8StringEncoding)
	set payload to current application's NSJSONSerialization's JSONObjectWithData:jsonData options:0 |error|:(missing value)
	if payload is missing value then error "Could not read trade stats"
	return payload
end computeStats

on loadTrades()
	set paths to {"/Users/andyyooi/trade-tracker/trades.json", "/Users/andyyooi/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/trade-tracker.json"}
	repeat with posixPath in paths
		set filePath to posixPath as text
		set jsonBytes to current application's NSData's dataWithContentsOfFile:filePath
		if jsonBytes is not missing value then
			if (jsonBytes's |length|() as integer) > 0 then
				set payload to current application's NSJSONSerialization's JSONObjectWithData:jsonBytes options:0 |error|:(missing value)
				if payload is not missing value then return payload
			end if
		end if
	end repeat
	error "Could not read trades.json"
end loadTrades

on formatPnl(value)
	set absValue to value
	if absValue < 0 then set absValue to -absValue
	set cents to round (absValue * 100)
	set dollars to cents div 100
	set remainder to cents mod 100
	set remainderText to remainder as text
	if remainder < 10 then set remainderText to "0" & remainderText
	set body to (dollars as text) & "." & remainderText
	if value > 0 then return "+$" & body
	if value < 0 then return "-$" & body
	return "$" & body
end formatPnl

on formatRate(value)
	set tenths to round (value * 10)
	set whole to tenths div 10
	set frac to tenths mod 10
	return (whole as text) & "." & (frac as text)
end formatRate

on colourFor(value)
	if value > 0 then return current application's NSColor's systemGreenColor()
	if value < 0 then return current application's NSColor's systemRedColor()
	return current application's NSColor's labelColor()
end colourFor

on colourItem_label_amount_(menuItem, labelText, amount)
	set fullText to labelText & "  " & my formatPnl(amount)
	set textColor to my colourFor(amount)
	set textFont to current application's NSFont's menuFontOfSize:13
	set attrs to current application's NSDictionary's dictionaryWithObjects:{textColor, textFont} forKeys:{current application's NSForegroundColorAttributeName, current application's NSFontAttributeName}
	set attrTitle to current application's NSAttributedString's alloc()'s initWithString:fullText attributes:attrs
	menuItem's setAttributedTitle:attrTitle
end colourItem_label_amount_

on colourBar_amount_(barItem, amount)
	set titleText to my formatPnl(amount)
	set textColor to my colourFor(amount)
	set textFont to current application's NSFont's menuBarFontOfSize:13
	set attrs to current application's NSDictionary's dictionaryWithObjects:{textColor, textFont} forKeys:{current application's NSForegroundColorAttributeName, current application's NSFontAttributeName}
	set attrTitle to current application's NSAttributedString's alloc()'s initWithString:titleText attributes:attrs
	barItem's button()'s setAttributedTitle:attrTitle
end colourBar_amount_

on openDashboard_(sender)
	current application's NSWorkspace's sharedWorkspace()'s openURL:(current application's NSURL's URLWithString:"https://trade-tracker-andees.vercel.app/")
end openDashboard_

on quitApp_(sender)
	current application's NSApp's terminate:(missing value)
end quitApp_
