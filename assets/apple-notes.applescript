use AppleScript version "2.4"
use framework "Foundation"
use scripting additions
set rows to current application's NSMutableArray's array()
set skippedCount to 0
with timeout of 120 seconds
 tell application "Notes"
  set accountList to every account
  repeat with acct in accountList
   set folderList to every folder of acct
   repeat with f in folderList
    set folderName to name of f as text
    if folderName is not "Recently Deleted" then
     set readableNotes to (every note of f whose password protected is false)
     set skippedCount to skippedCount + (count of every note of f) - (count of readableNotes)
     set noteIds to id of (every note of f whose password protected is false)
     set noteTitles to name of (every note of f whose password protected is false)
     set noteTexts to plaintext of (every note of f whose password protected is false)
     set noteDates to modification date of (every note of f whose password protected is false)
     repeat with i from 1 to count of noteIds
      set recordData to {|id|:(item i of noteIds as text), |title|:(item i of noteTitles as text), |text|:(item i of noteTexts as text), |folder|:folderName, |modified|:((item i of noteDates) as «class isot» as string)}
      rows's addObject:recordData
     end repeat
    end if
   end repeat
  end repeat
 end tell
end timeout
set resultData to current application's NSJSONSerialization's dataWithJSONObject:{|notes|:rows, |skipped|:skippedCount} options:0 |error|:(missing value)
set resultString to current application's NSString's alloc()'s initWithData:resultData encoding:(current application's NSUTF8StringEncoding)
return resultString as text